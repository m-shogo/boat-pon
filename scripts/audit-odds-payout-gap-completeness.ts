/**
 * audit-odds-payout-gap-completeness.ts — 読み取り専用
 *
 * analyze-odds-payout-gap.ts / analyze-payout-rebase.ts が欠落・重複・返還 settlement を
 * 0円払戻や任意の LIMIT 1 行として解釈する前に、対象 race の official trifecta
 * settlement integrity を確認する。
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

type IntegrityRow = {
  total: number;
  covered: number;
  cohortInvalidRows: number;
  invalidWinningKeyShapes: number;
  invalidNonRefundRows: number;
  duplicateCombinationKeys: number;
  invalidSettlementReturnRows: number;
  invalidWinningKeys: number;
};

const row = db.prepare(`
WITH target_rows AS (
  SELECT dh.race_id, dh.bet_type, dh.returned, dh.result
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.venue NOT IN (${EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",")})
    AND dh.race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
), target_races AS (
  SELECT DISTINCT race_id
  FROM target_rows
  WHERE bet_type = '3連単'
    AND returned = 0
), target_winning_keys AS (
  SELECT DISTINCT race_id, result AS combination
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
), invalid_winning_keys AS (
  SELECT twk.race_id, twk.combination
  FROM target_winning_keys twk
  WHERE (
    SELECT COUNT(*)
    FROM target_settlements ts
    WHERE ts.race_id = twk.race_id
      AND ts.combination = twk.combination
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM target_settlements ts
    WHERE ts.race_id = twk.race_id
      AND ts.combination = twk.combination
      AND ts.returned = 0
      AND ts.payout_yen > 0
  ) != 1
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
   FROM target_rows tr
   WHERE tr.bet_type = '3連単'
     AND tr.returned = 0
     AND (
       length(tr.result) != 5
       OR tr.result NOT GLOB '[1-6]-[1-6]-[1-6]'
       OR substr(tr.result, 1, 1) = substr(tr.result, 3, 1)
       OR substr(tr.result, 1, 1) = substr(tr.result, 5, 1)
       OR substr(tr.result, 3, 1) = substr(tr.result, 5, 1)
     )
  ) AS invalidWinningKeyShapes,
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
  ) AS invalidSettlementReturnRows,
  (SELECT COUNT(*) FROM invalid_winning_keys) AS invalidWinningKeys
`).get() as IntegrityRow;

const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row.covered ?? 0);
db.close();

console.log(
  `[odds-payout-gap-preflight] covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces} cohortInvalid=${row.cohortInvalidRows ?? 0} invalidWinningKeyShapes=${row.invalidWinningKeyShapes ?? 0} invalidNonRefund=${row.invalidNonRefundRows ?? 0} duplicateKeys=${row.duplicateCombinationKeys ?? 0} invalidSettlementReturns=${row.invalidSettlementReturnRows ?? 0} invalidWinningKeys=${row.invalidWinningKeys ?? 0}`,
);

if ((row.cohortInvalidRows ?? 0) > 0) {
  console.error("[odds-payout-gap-preflight] FAIL: target research cohort contains non-3連単 or returned/unknown-return historical BUY rows, but downstream ROI consumers do not exclude them explicitly");
  process.exit(2);
}

if ((row.invalidWinningKeyShapes ?? 0) > 0) {
  console.error("[odds-payout-gap-preflight] FAIL: target cohort contains malformed historical 3連単 winning result keys; exact-key payout ROI and payout rebase must remain unavailable");
  process.exit(2);
}

if ((row.invalidNonRefundRows ?? 0) > 0) {
  console.error("[odds-payout-gap-preflight] FAIL: target cohort contains non-refund trifecta settlement rows without a non-empty combination and positive official payout");
  process.exit(2);
}

if ((row.duplicateCombinationKeys ?? 0) > 0) {
  console.error("[odds-payout-gap-preflight] FAIL: target cohort contains duplicate race_id × trifecta × combination settlement keys; LIMIT 1 consumers must not choose an arbitrary row");
  process.exit(2);
}

if ((row.invalidSettlementReturnRows ?? 0) > 0) {
  console.error("[odds-payout-gap-preflight] FAIL: target cohort contains refunded or unknown-return trifecta settlement rows, but downstream payout-rebase consumers require unambiguous non-refund settlements");
  process.exit(2);
}

if ((row.invalidWinningKeys ?? 0) > 0) {
  console.error("[odds-payout-gap-preflight] FAIL: one or more historical winning result keys do not have exactly one positive non-refund official trifecta settlement; exact-key payout ROI must remain unavailable");
  process.exit(2);
}

if (!result.complete) {
  console.error("[odds-payout-gap-preflight] FAIL: complete positive non-refund official trifecta settlement coverage is required; payout ROI/verdict interpretation must remain unavailable");
  process.exit(2);
}

console.log("[odds-payout-gap-preflight] PASS: official trifecta settlement coverage, exact winning-key integrity, return-state integrity, and line integrity are complete for the analysis population");
