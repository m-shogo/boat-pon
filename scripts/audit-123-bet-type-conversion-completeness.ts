/**
 * audit-123-bet-type-conversion-completeness.ts — research-only/read-only
 *
 * Proves that every race in the exact 1-2-3 historical analysis population has
 * a positive official settlement for every bet type compared by the analyzer,
 * and that the settlement rows consumed by scalar combination lookups are
 * unambiguous and safe to interpret.
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

const populationWhere = `
  dh.decision = 'BUY'
  AND dh.run_kind = 'historical-backfill'
  AND dh.result IS NOT NULL
  AND dh.result != ''
  AND dh.venue NOT IN (${EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",")})
  AND dh.race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
  AND dh.selection = '1-2-3'
`;

const invalidReturnState = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE ${populationWhere}
    AND (dh.returned IS NULL OR dh.returned != 0)
`).get() as { invalid: number };

if ((invalidReturnState.invalid ?? 0) > 0) {
  db.close();
  console.error(
    `[123-bet-type-preflight] FAIL: target historical BUY cohort contains returned or unknown-return rows (invalid=${invalidReturnState.invalid ?? 0}); cross-bet ROI/verdict interpretation must remain unavailable`,
  );
  process.exit(2);
}

const row = db.prepare(`
  SELECT
    COUNT(*) AS total,
    ${REQUIRED_BET_TYPES.map((betType) => `SUM(CASE WHEN EXISTS (
      SELECT 1
      FROM race_payouts rp
      WHERE rp.race_id = dh.race_id
        AND rp.bet_type = '${betType}'
        AND rp.returned = 0
        AND rp.payout_yen > 0
        AND TRIM(COALESCE(rp.combination, '')) != ''
    ) THEN 1 ELSE 0 END) AS ${betType}`).join(",\n    ")}
  FROM decision_history dh
  WHERE ${populationWhere}
    AND dh.returned = 0
`).get() as CoverageRow;

let complete = true;
for (const betType of REQUIRED_BET_TYPES) {
  const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row[betType] ?? 0);
  console.log(
    `[123-bet-type-preflight] ${betType}: covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces}`,
  );
  if (!result.complete) complete = false;
}

const integrity = db.prepare(`
WITH population AS (
  SELECT DISTINCT dh.race_id
  FROM decision_history dh
  WHERE ${populationWhere}
    AND dh.returned = 0
), relevant AS (
  SELECT rp.race_id, rp.bet_type, rp.combination, rp.payout_yen, rp.returned
  FROM race_payouts rp
  JOIN population p ON p.race_id = rp.race_id
  WHERE rp.bet_type IN (${REQUIRED_BET_TYPES.map((betType) => `'${betType}'`).join(",")})
), malformed AS (
  SELECT race_id, bet_type, combination
  FROM relevant
  WHERE returned IS NULL
     OR returned != 0
     OR payout_yen IS NULL
     OR payout_yen <= 0
     OR TRIM(COALESCE(combination, '')) = ''
), duplicate_keys AS (
  SELECT race_id, bet_type, combination
  FROM relevant
  GROUP BY race_id, bet_type, combination
  HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*) FROM malformed) AS malformed,
  (SELECT COUNT(*) FROM duplicate_keys) AS duplicateKeys
`).get() as { malformed: number; duplicateKeys: number };

db.close();

if (!complete) {
  console.error("[123-bet-type-preflight] FAIL: one or more required official settlement types are missing a positive non-refund payout; cross-bet ROI/verdict interpretation must remain unavailable");
  process.exit(2);
}

if ((integrity.malformed ?? 0) > 0 || (integrity.duplicateKeys ?? 0) > 0) {
  console.error(
    `[123-bet-type-preflight] FAIL: settlement integrity invalid (malformed=${integrity.malformed ?? 0}, duplicateKeys=${integrity.duplicateKeys ?? 0}); cross-bet ROI/verdict interpretation must remain unavailable`,
  );
  process.exit(3);
}

console.log("[123-bet-type-preflight] PASS: all required official settlement types are complete, positive, non-refund, and unique per combination for the exact analysis population");
