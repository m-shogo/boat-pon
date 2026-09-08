/**
 * audit-roi-edge-market-gap-payout-completeness.ts — research-only/read-only
 *
 * Verify that every race in the forward BUY population used by the ROI edge
 * market-gap analyzer has trustworthy official trifecta settlement data before
 * 1-2-3 ROI, 1-3-2 missed-opportunity ROI, or payout-based verdicts are interpreted.
 * Legitimate multi-line winners are allowed; malformed, duplicate-combination,
 * refund rows, or decision-cohort drift fail closed because the downstream scalar
 * payout lookups do not model those ambiguities explicitly.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { evaluatePaperForwardPayoutCompleteness } from "../src/research-replay/paperForwardPayoutCompleteness";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FORWARD_START = "2025-01-01";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[roi-edge-market-gap-payout-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "ROI edge market-gap primary database");
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
const excludedVenues = EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",");
const excludedRaces = EXCLUDED_RACES.join(",");

const row = db.prepare(`
WITH target_rows AS (
  SELECT dh.race_id, dh.bet_type, dh.returned
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
  (SELECT COUNT(*) FROM target_rows tr
   WHERE tr.bet_type IS NULL
      OR tr.bet_type != '3連単'
      OR tr.returned IS NULL
      OR tr.returned != 0) AS cohortInvalidRows,
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
     AND (
       ts.combination IS NULL
       OR ts.combination = ''
       OR ts.payout_yen IS NULL
       OR ts.payout_yen <= 0
     )
  ) AS invalidNonRefundRows,
  (SELECT COUNT(*) FROM duplicate_keys) AS duplicateCombinationKeys,
  (SELECT COUNT(*)
   FROM target_settlements ts
   WHERE ts.returned = 1
  ) AS returnedRows
`).get(FORWARD_START) as IntegrityRow;

const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row.covered ?? 0);
db.close();

console.log(
  `[roi-edge-market-gap-payout-preflight] covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces} cohortInvalid=${row.cohortInvalidRows ?? 0} invalidNonRefund=${row.invalidNonRefundRows ?? 0} duplicateKeys=${row.duplicateCombinationKeys ?? 0} returnedRows=${row.returnedRows ?? 0}`,
);

if ((row.cohortInvalidRows ?? 0) > 0) {
  console.error("[roi-edge-market-gap-payout-preflight] FAIL: target analyzer population contains non-3連単 or returned/unknown-return historical BUY rows; payout verdicts must remain unavailable");
  process.exit(2);
}

if ((row.invalidNonRefundRows ?? 0) > 0) {
  console.error("[roi-edge-market-gap-payout-preflight] FAIL: target cohort contains non-refund trifecta settlement rows without a non-empty combination and positive official payout");
  process.exit(2);
}

if ((row.duplicateCombinationKeys ?? 0) > 0) {
  console.error("[roi-edge-market-gap-payout-preflight] FAIL: target cohort contains duplicate race_id × trifecta × combination settlement keys; scalar payout consumers must not choose an arbitrary row");
  process.exit(2);
}

if ((row.returnedRows ?? 0) > 0) {
  console.error("[roi-edge-market-gap-payout-preflight] FAIL: target cohort contains trifecta refund rows, but the downstream analyzer does not model refund semantics explicitly");
  process.exit(2);
}

if (!result.complete) {
  console.error("[roi-edge-market-gap-payout-preflight] ROI_EDGE_MARKET_GAP_TRIFECTA_PAYOUT_COVERAGE_INCOMPLETE: complete positive non-refund official trifecta settlement coverage is required; payout ROI/verdicts must remain unavailable");
  process.exit(2);
}

console.log("[roi-edge-market-gap-payout-preflight] PASS: official trifecta settlement coverage and line integrity are complete for the market-gap population");
