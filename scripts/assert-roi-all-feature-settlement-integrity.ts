import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const DECISION_BET_TYPE = "3連単";
const PAYOUT_BET_TYPE = "trifecta";

if (!existsSync(DB_PATH)) {
  console.error("[assert-roi-all-feature-settlement-integrity] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_ALL_FEATURE_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });

try {
  db.exec("PRAGMA query_only = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const invalidReturn = db.prepare(`
SELECT COUNT(*) AS n
FROM decision_history
WHERE run_kind = 'historical-backfill'
  AND decision = 'BUY'
  AND bet_type = ?
  AND current_odds IS NOT NULL
  AND result IS NOT NULL
  AND result != ''
  AND (returned IS NULL OR returned != 0)
`).get(DECISION_BET_TYPE) as { n: number };

  if ((invalidReturn.n ?? 0) > 0) {
    throw new Error(
      `ROI_ALL_FEATURE_RETURN_STATE_INVALID: ${invalidReturn.n} historical BUY row(s) have unknown or returned settlement state`,
    );
  }

  const row = db.prepare(`
WITH relevant_settled AS (
  SELECT DISTINCT race_id, result
  FROM decision_history
  WHERE run_kind = 'historical-backfill'
    AND decision = 'BUY'
    AND bet_type = ?
    AND current_odds IS NOT NULL
    AND result IS NOT NULL
    AND result != ''
    AND returned = 0
), invalid AS (
  SELECT s.race_id, s.result
  FROM relevant_settled s
  WHERE (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = ?
      AND rp.combination = s.result
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = ?
      AND rp.combination = s.result
      AND rp.returned = 0
      AND rp.payout_yen IS NOT NULL
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE) as { n: number };

  if ((row.n ?? 0) > 0) {
    throw new Error(
      `ROI_ALL_FEATURE_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.n} settled historical BUY denominator race(s) do not have exactly one positive non-refund official winning settlement`,
    );
  }

  console.log("[assert-roi-all-feature-settlement-integrity] PASS");
} finally {
  db.close();
}
