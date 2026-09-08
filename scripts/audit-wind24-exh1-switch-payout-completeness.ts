/**
 * audit-wind24-exh1-switch-payout-completeness.ts — research-only/read-only
 *
 * Ensures every race used by the wind2-4m/s × boat-1 exhibition-fastest
 * 1-3-2 switch deep-dive has complete, unambiguous official trifecta settlement
 * integrity before ROI-based promotion/demotion criteria are interpreted.
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

type IntegrityRow = {
  total: number;
  covered: number;
  cohortInvalidRows: number;
  invalidNonRefundRows: number;
  duplicateCombinationKeys: number;
  returnedRows: number;
};

const row = db.prepare(`
WITH target_rows AS (
  SELECT dh.race_id, dh.bet_type, dh.returned
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
), target_races AS (
  SELECT DISTINCT race_id
  FROM target_rows
  WHERE bet_type = '3連単'
    AND returned = 0
), target_settlements AS (
  SELECT rp.race_id, rp.combination, rp.payout_yen, rp.returned
  FROM race_payouts rp
  JOIN target_races tr ON tr.race_id = rp.race_id
  WHERE rp.bet_type = 'trifecta'
), duplicate_keys AS (
  SELECT race_id, combination
  FROM target_settlements
  GROUP BY race_id, combination
  HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*) FROM target_races) AS total,
  (SELECT COUNT(*)
   FROM target_rows tr
   WHERE tr.bet_type IS NULL
      OR tr.bet_type != '3連単'
      OR tr.returned IS NULL
      OR tr.returned != 0
  ) AS cohortInvalidRows,
  (SELECT COUNT(*)
   FROM target_races tr
   WHERE EXISTS (
     SELECT 1
     FROM target_settlements ts
     WHERE ts.race_id = tr.race_id
       AND ts.returned = 0
       AND ts.payout_yen > 0
   )) AS covered,
  (SELECT COUNT(*)
   FROM target_settlements ts
   WHERE ts.returned = 0
     AND (ts.combination IS NULL OR ts.combination = '' OR ts.payout_yen IS NULL OR ts.payout_yen <= 0)
  ) AS invalidNonRefundRows,
  (SELECT COUNT(*) FROM duplicate_keys) AS duplicateCombinationKeys,
  (SELECT COUNT(*)
   FROM target_settlements ts
   WHERE ts.returned IS NULL OR ts.returned != 0
  ) AS returnedRows
`).get() as IntegrityRow;

db.close();

const total = row.total ?? 0;
const covered = row.covered ?? 0;
const cohortInvalidRows = row.cohortInvalidRows ?? 0;
const invalidNonRefundRows = row.invalidNonRefundRows ?? 0;
const duplicateCombinationKeys = row.duplicateCombinationKeys ?? 0;
const returnedRows = row.returnedRows ?? 0;
const validCounts = Number.isSafeInteger(total) && Number.isSafeInteger(covered) && total >= 0 && covered >= 0 && covered <= total;
const complete = validCounts && total > 0 && covered === total;
const missing = validCounts ? total - covered : null;
const coverageRate = validCounts && total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;

console.log(
  `[wind24-switch-payout-preflight] covered=${covered}/${total} (${coverageRate}%) missing=${missing ?? "invalid"} cohortInvalid=${cohortInvalidRows} invalidNonRefund=${invalidNonRefundRows} duplicateKeys=${duplicateCombinationKeys} returnedRows=${returnedRows}`,
);

if (cohortInvalidRows > 0) {
  console.error("[wind24-switch-payout-preflight] FAIL: target research cohort contains non-3連単 or returned/unknown-return historical BUY rows, but the deep-dive ROI consumers do not exclude them explicitly");
  process.exit(2);
}

if (invalidNonRefundRows > 0) {
  console.error("[wind24-switch-payout-preflight] FAIL: target cohort contains non-refund trifecta settlement rows without a non-empty combination and positive official payout");
  process.exit(2);
}

if (duplicateCombinationKeys > 0) {
  console.error("[wind24-switch-payout-preflight] FAIL: target cohort contains duplicate race_id × trifecta × combination settlement keys; scalar payout consumers must not choose an arbitrary row");
  process.exit(2);
}

if (returnedRows > 0) {
  console.error("[wind24-switch-payout-preflight] FAIL: target cohort contains trifecta refund or unknown-return settlement rows, but the switch deep-dive does not model those semantics explicitly");
  process.exit(2);
}

if (!complete) {
  console.error("[wind24-switch-payout-preflight] FAIL: complete positive non-refund official trifecta settlement coverage is required; switch promotion/demotion verdicts must remain unavailable");
  process.exit(2);
}

console.log("[wind24-switch-payout-preflight] PASS: official trifecta settlement coverage and line integrity are complete for the deep-dive population");