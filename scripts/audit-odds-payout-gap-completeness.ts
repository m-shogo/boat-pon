/**
 * audit-odds-payout-gap-completeness.ts — 読み取り専用
 *
 * analyze-odds-payout-gap.ts が欠落 settlement を 0 円払戻として解釈する前に、
 * 対象 race すべてに official trifecta settlement が存在することを確認する。
 * DB / app_settings / production decision / automated betting は変更しない。
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { evaluatePaperForwardPayoutCompleteness } from "../src/research-replay/paperForwardPayoutCompleteness";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[odds-payout-gap-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "odds-payout-gap primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type CoverageRow = { total: number; covered: number };

const row = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN EXISTS (
      SELECT 1
      FROM race_payouts rp
      WHERE rp.race_id = dh.race_id
        AND rp.bet_type = 'trifecta'
    ) THEN 1 ELSE 0 END) AS covered
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.venue NOT IN (${EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",")})
    AND dh.race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`).get() as CoverageRow;

const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row.covered ?? 0);
db.close();

console.log(
  `[odds-payout-gap-preflight] covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces}`,
);

if (!result.complete) {
  console.error("[odds-payout-gap-preflight] FAIL: official trifecta settlement coverage is incomplete; payout ROI/verdict interpretation must remain unavailable");
  process.exit(2);
}

console.log("[odds-payout-gap-preflight] PASS: official trifecta settlement coverage is complete for the analysis population");
