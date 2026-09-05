/**
 * audit-roi-skip-interactions-payout-completeness.ts — research-only/read-only
 *
 * Requires complete official trifecta settlement coverage for the exact forward
 * BUY population consumed by analyze-roi-skip-interactions before any ROI,
 * residual-effect, or skip comparison is interpreted.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { evaluatePaperForwardPayoutCompleteness } from "../src/research-replay/paperForwardPayoutCompleteness";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FORWARD_START = "2025-01-01";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[skip-interactions-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "skip-interactions primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type CoverageRow = { total: number; covered: number };
const row = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM race_payouts rp
      WHERE rp.race_id = dh.race_id
        AND rp.bet_type = 'trifecta'
        AND rp.payout_yen IS NOT NULL
    ) THEN 1 ELSE 0 END) AS covered
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",")})
    AND dh.race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
    AND dh.selection = '1-2-3'
    AND dh.date >= '${FORWARD_START}'
`).get() as CoverageRow;

const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row.covered ?? 0);
db.close();

console.log(`[skip-interactions-preflight] covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces}`);
if (!result.complete) {
  console.error("[skip-interactions-preflight] FAIL: official trifecta settlement coverage is incomplete; ROI/residual verdict interpretation must remain unavailable");
  process.exit(2);
}

console.log("[skip-interactions-preflight] PASS: official trifecta settlement coverage is complete for the exact forward analysis population");
