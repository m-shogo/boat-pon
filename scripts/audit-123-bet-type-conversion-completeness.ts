/**
 * audit-123-bet-type-conversion-completeness.ts — research-only/read-only
 *
 * Proves that every race in the exact 1-2-3 historical analysis population has
 * a positive official settlement for every bet type compared by the analyzer.
 * Missing, null, zero, or negative settlement values must remain unavailable
 * rather than becoming a synthetic zero-return observation.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { evaluatePaperForwardPayoutCompleteness } from "../src/research-replay/paperForwardPayoutCompleteness";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];
const REQUIRED_BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;

type RequiredBetType = typeof REQUIRED_BET_TYPES[number];
type CoverageRow = { total: number } & Record<RequiredBetType, number>;

if (!existsSync(DB_PATH)) {
  console.error("[123-bet-type-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "123 bet-type conversion primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

const row = db.prepare(`
  SELECT
    COUNT(*) AS total,
    ${REQUIRED_BET_TYPES.map((betType) => `SUM(CASE WHEN EXISTS (
      SELECT 1
      FROM race_payouts rp
      WHERE rp.race_id = dh.race_id
        AND rp.bet_type = '${betType}'
        AND rp.payout_yen > 0
    ) THEN 1 ELSE 0 END) AS ${betType}`).join(",\n    ")}
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.venue NOT IN (${EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",")})
    AND dh.race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
    AND dh.selection = '1-2-3'
`).get() as CoverageRow;

let complete = true;
for (const betType of REQUIRED_BET_TYPES) {
  const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row[betType] ?? 0);
  console.log(
    `[123-bet-type-preflight] ${betType}: covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces}`,
  );
  if (!result.complete) complete = false;
}

db.close();

if (!complete) {
  console.error("[123-bet-type-preflight] FAIL: one or more required official settlement types are missing a positive payout; cross-bet ROI/verdict interpretation must remain unavailable");
  process.exit(2);
}

console.log("[123-bet-type-preflight] PASS: all required official settlement types have positive payouts for the exact analysis population");
