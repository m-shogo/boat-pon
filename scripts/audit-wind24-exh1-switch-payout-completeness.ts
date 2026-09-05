/**
 * audit-wind24-exh1-switch-payout-completeness.ts — research-only/read-only
 *
 * Ensures every race used by the wind2-4m/s × boat-1 exhibition-fastest
 * 1-3-2 switch deep-dive has an official trifecta settlement before ROI-based
 * promotion/demotion criteria are interpreted.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[wind24-switch-payout-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "wind24 switch primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type CoverageRow = { total: number; covered: number };

const row = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM race_payouts rp
      WHERE rp.race_id = dh.race_id AND rp.bet_type = 'trifecta'
    ) THEN 1 ELSE 0 END) AS covered
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.venue NOT IN (${EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",")})
    AND dh.race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
    AND dh.selection = '1-2-3'
    AND EXISTS (
      SELECT 1 FROM race_weather rw
      WHERE rw.race_id = dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4
    )
    AND EXISTS (
      SELECT 1
      FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id = re.race_id AND ed.course = re.entry_course
      WHERE re.race_id = dh.race_id
        AND re.boat = 1
        AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time)
          FROM exhibition_data ed2
          WHERE ed2.race_id = dh.race_id
        )
    )
`).get() as CoverageRow;

db.close();

const total = row.total ?? 0;
const covered = row.covered ?? 0;
const validCounts = Number.isSafeInteger(total) && Number.isSafeInteger(covered) && total >= 0 && covered >= 0 && covered <= total;
const complete = validCounts && total > 0 && covered === total;
const missing = validCounts ? total - covered : null;
const coverageRate = validCounts && total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;

console.log(`[wind24-switch-payout-preflight] covered=${covered}/${total} (${coverageRate}%) missing=${missing ?? "invalid"}`);

if (!complete) {
  console.error("[wind24-switch-payout-preflight] FAIL: official trifecta settlement coverage is incomplete; switch promotion/demotion verdicts must remain unavailable");
  process.exit(2);
}

console.log("[wind24-switch-payout-preflight] PASS: official trifecta settlement coverage is complete for the deep-dive population");
