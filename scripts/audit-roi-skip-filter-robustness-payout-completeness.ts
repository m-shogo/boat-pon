/**
 * audit-roi-skip-filter-robustness-payout-completeness.ts — research-only/read-only
 *
 * Verify that every race in the skip-filter robustness research population has
 * an official trifecta settlement before payout ROI is used for finalVerdict.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACES = [10, 11, 12];
const FORWARD_START = "2025-01-01";

if (!existsSync(DB_PATH)) {
  console.error("[skip-filter-robustness-payout-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "skip-filter robustness primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type CoverageRow = { total: number; covered: number };
const excludedVenues = EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",");
const excludedRaces = EXCLUDED_RACES.join(",");

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
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excludedVenues})
    AND dh.race_no NOT IN (${excludedRaces})
    AND dh.selection = '1-2-3'
    AND dh.date >= ?
`).get(FORWARD_START) as CoverageRow;

db.close();

const total = row.total ?? 0;
const covered = row.covered ?? 0;
const validCounts = Number.isSafeInteger(total) && Number.isSafeInteger(covered)
  && total >= 0 && covered >= 0 && covered <= total;
const complete = validCounts && total > 0 && covered === total;
const missing = validCounts ? total - covered : null;
const coverageRate = validCounts && total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;

console.log(`[skip-filter-robustness-payout-preflight] covered=${covered}/${total} (${coverageRate}%) missing=${missing ?? "invalid"}`);

if (!complete) {
  console.error("[skip-filter-robustness-payout-preflight] FAIL: official trifecta settlement coverage is incomplete; robustness finalVerdict must remain unavailable");
  process.exit(2);
}

console.log("[skip-filter-robustness-payout-preflight] PASS: official trifecta settlement coverage is complete for the robustness population");
