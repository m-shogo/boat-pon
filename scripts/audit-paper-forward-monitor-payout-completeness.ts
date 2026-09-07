/**
 * audit-paper-forward-monitor-payout-completeness.ts — research-only/read-only
 *
 * The paper-forward monitor compares train and forward slices of the historical
 * 1-2-3 BUY population and computes counterfactual 1-3-2 payout ROI. Prove the
 * entire target race settlement is trustworthy before any payout-derived monitor
 * verdict can be emitted: legitimate multi-line winners are allowed, but malformed,
 * duplicate-combination, or refund rows are fail-closed because the downstream
 * scalar payout lookups do not model those ambiguities explicitly.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { evaluatePaperForwardPayoutCompleteness } from "../src/research-replay/paperForwardPayoutCompleteness";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[paper-forward-monitor-payout-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "paper-forward monitor primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type IntegrityRow = {
  total: number;
  covered: number;
  invalidNonRefundRows: number;
  duplicateCombinationKeys: number;
  returnedRows: number;
};

const excludedVenues = EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",");
const excludedRaces = EXCLUDED_RACES.join(",");

const row = db.prepare(`
WITH target_races AS (
  SELECT DISTINCT dh.race_id
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.venue NOT IN (${excludedVenues})
    AND dh.race_no NOT IN (${excludedRaces})
    AND dh.selection = '1-2-3'
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
`).get() as IntegrityRow;

const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row.covered ?? 0);
db.close();

console.log(
  `[paper-forward-monitor-payout-preflight] covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces} invalidNonRefund=${row.invalidNonRefundRows ?? 0} duplicateKeys=${row.duplicateCombinationKeys ?? 0} returnedRows=${row.returnedRows ?? 0}`,
);

if ((row.invalidNonRefundRows ?? 0) > 0) {
  console.error("[paper-forward-monitor-payout-preflight] FAIL: target cohort contains non-refund trifecta settlement rows without a non-empty combination and positive official payout");
  process.exit(2);
}

if ((row.duplicateCombinationKeys ?? 0) > 0) {
  console.error("[paper-forward-monitor-payout-preflight] FAIL: target cohort contains duplicate race_id × trifecta × combination settlement keys; scalar payout consumers must not choose an arbitrary row");
  process.exit(2);
}

if ((row.returnedRows ?? 0) > 0) {
  console.error("[paper-forward-monitor-payout-preflight] FAIL: target cohort contains trifecta refund rows, but the downstream monitor does not model refund semantics explicitly");
  process.exit(2);
}

if (!result.complete) {
  console.error("[paper-forward-monitor-payout-preflight] PAPER_FORWARD_MONITOR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE: complete positive non-refund official trifecta settlement coverage is required; monitor payout ROI/trend/verdicts must remain unavailable");
  process.exit(2);
}

console.log("[paper-forward-monitor-payout-preflight] PASS: official trifecta settlement coverage and line integrity are complete for the monitor population");
