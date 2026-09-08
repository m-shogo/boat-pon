/**
 * audit-ticket-selector-payout-completeness.ts — research-only/read-only
 *
 * Ticket-selector research compares trifecta, trio, exacta, quinella, and wide
 * returns. Missing or ambiguous settlement lines for any compared market must not
 * be interpreted as zero-return races when choosing train/forward strategies.
 * Legitimate multi-line winners are allowed; malformed, duplicate-combination,
 * or refund rows fail closed because the downstream selector uses scalar LIMIT 1
 * payout lookups and does not model refund ambiguity explicitly.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];
const BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;

type BetType = (typeof BET_TYPES)[number];
type IntegrityRow = {
  total: number;
  cov_trifecta: number;
  cov_trio: number;
  cov_exacta: number;
  cov_quinella: number;
  cov_wide: number;
  invalidNonRefundRows: number;
  duplicateCombinationKeys: number;
  invalidSettlementReturnStates: number;
};

if (!existsSync(DB_PATH)) {
  console.error("[ticket-selector-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "ticket selector primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const excludedVenues = EXCLUDED_VENUES.map(() => "?").join(",");
  const excludedRaceNos = EXCLUDED_RACE_NOS.map(() => "?").join(",");

  const invalidBuyReturnStates = db.prepare(`
    SELECT COUNT(*) AS count
    FROM decision_history dh
    WHERE dh.decision='BUY'
      AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.current_odds IS NOT NULL
      AND dh.venue NOT IN (${excludedVenues})
      AND dh.race_no NOT IN (${excludedRaceNos})
      AND dh.selection='1-2-3'
      AND (dh.returned IS NULL OR dh.returned != 0)
  `).get(...EXCLUDED_VENUES, ...EXCLUDED_RACE_NOS) as { count: number };

  if (Number(invalidBuyReturnStates.count ?? 0) > 0) {
    console.error("[ticket-selector-preflight] FAIL: target historical BUY cohort contains unknown or returned rows");
    process.exit(2);
  }

  const row = db.prepare(`
    WITH target_races AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY'
        AND dh.run_kind='historical-backfill'
        AND dh.returned=0
        AND dh.result IS NOT NULL AND dh.result != ''
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${excludedVenues})
        AND dh.race_no NOT IN (${excludedRaceNos})
        AND dh.selection='1-2-3'
    ), target_settlements AS (
      SELECT rp.race_id, rp.bet_type, rp.combination, rp.payout_yen, rp.returned
      FROM race_payouts rp
      JOIN target_races tr ON tr.race_id = rp.race_id
      WHERE rp.bet_type IN ('trifecta', 'trio', 'exacta', 'quinella', 'wide')
    ), duplicate_keys AS (
      SELECT race_id, bet_type, combination
      FROM target_settlements
      GROUP BY race_id, bet_type, combination
      HAVING COUNT(*) > 1
    )
    SELECT
      (SELECT COUNT(*) FROM target_races) AS total,
      (SELECT COUNT(*) FROM target_races tr WHERE EXISTS (
        SELECT 1 FROM target_settlements ts
        WHERE ts.race_id=tr.race_id AND ts.bet_type='trifecta'
          AND ts.returned=0 AND ts.payout_yen>0
      )) AS cov_trifecta,
      (SELECT COUNT(*) FROM target_races tr WHERE EXISTS (
        SELECT 1 FROM target_settlements ts
        WHERE ts.race_id=tr.race_id AND ts.bet_type='trio'
          AND ts.returned=0 AND ts.payout_yen>0
      )) AS cov_trio,
      (SELECT COUNT(*) FROM target_races tr WHERE EXISTS (
        SELECT 1 FROM target_settlements ts
        WHERE ts.race_id=tr.race_id AND ts.bet_type='exacta'
          AND ts.returned=0 AND ts.payout_yen>0
      )) AS cov_exacta,
      (SELECT COUNT(*) FROM target_races tr WHERE EXISTS (
        SELECT 1 FROM target_settlements ts
        WHERE ts.race_id=tr.race_id AND ts.bet_type='quinella'
          AND ts.returned=0 AND ts.payout_yen>0
      )) AS cov_quinella,
      (SELECT COUNT(*) FROM target_races tr WHERE EXISTS (
        SELECT 1 FROM target_settlements ts
        WHERE ts.race_id=tr.race_id AND ts.bet_type='wide'
          AND ts.returned=0 AND ts.payout_yen>0
      )) AS cov_wide,
      (SELECT COUNT(*) FROM target_settlements ts
       WHERE ts.returned=0 AND (
         ts.combination IS NULL OR ts.combination='' OR
         ts.payout_yen IS NULL OR ts.payout_yen<=0
       )) AS invalidNonRefundRows,
      (SELECT COUNT(*) FROM duplicate_keys) AS duplicateCombinationKeys,
      (SELECT COUNT(*) FROM target_settlements ts
       WHERE ts.returned IS NULL OR ts.returned != 0) AS invalidSettlementReturnStates
  `).get(...EXCLUDED_VENUES, ...EXCLUDED_RACE_NOS) as IntegrityRow;

  const total = Number(row.total ?? 0);
  const invalidNonRefundRows = Number(row.invalidNonRefundRows ?? 0);
  const duplicateCombinationKeys = Number(row.duplicateCombinationKeys ?? 0);
  const invalidSettlementReturnStates = Number(row.invalidSettlementReturnStates ?? 0);
  let complete = Number.isSafeInteger(total) && total > 0;

  console.log(
    `[ticket-selector-preflight] population=${total} invalidNonRefund=${invalidNonRefundRows} duplicateKeys=${duplicateCombinationKeys} invalidSettlementReturnStates=${invalidSettlementReturnStates}`,
  );

  for (const betType of BET_TYPES) {
    const covered = Number(row[`cov_${betType}` as `cov_${BetType}`] ?? 0);
    const validCovered = Number.isSafeInteger(covered) && covered >= 0 && covered <= total;
    const missing = validCovered ? total - covered : null;
    const pct = validCovered && total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;
    console.log(`[ticket-selector-preflight] ${betType}: covered=${covered}/${total} (${pct}%) missing=${missing ?? "invalid"}`);
    if (!validCovered || covered !== total) complete = false;
  }

  if (invalidNonRefundRows > 0) {
    console.error("[ticket-selector-preflight] FAIL: compared markets contain non-refund settlement rows without a non-empty combination and positive official payout");
    process.exit(2);
  }

  if (duplicateCombinationKeys > 0) {
    console.error("[ticket-selector-preflight] FAIL: compared markets contain duplicate race_id × bet_type × combination settlement keys; scalar payout consumers must not choose an arbitrary row");
    process.exit(2);
  }

  if (invalidSettlementReturnStates > 0) {
    console.error("[ticket-selector-preflight] FAIL: compared markets contain unknown or returned settlement states, but the downstream selector does not model those semantics explicitly");
    process.exit(2);
  }

  if (!complete) {
    console.error("[ticket-selector-preflight] FAIL: positive non-refund compared-market settlement coverage is incomplete; selector ROI/best-strategy verdicts must remain unavailable");
    process.exit(2);
  }

  console.log("[ticket-selector-preflight] PASS: all compared payout markets have complete coverage and unambiguous settlement line integrity for the selector population");
} finally {
  db.close();
}
