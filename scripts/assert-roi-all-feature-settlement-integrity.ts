import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

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

  const row = db.prepare(`
WITH relevant_hits AS (
  SELECT DISTINCT race_id, bet_type, selection
  FROM decision_history
  WHERE run_kind = 'historical-backfill'
    AND decision = 'BUY'
    AND current_odds IS NOT NULL
    AND result IS NOT NULL
    AND result != ''
    AND returned = 0
    AND selection = result
), invalid AS (
  SELECT h.race_id, h.bet_type, h.selection
  FROM relevant_hits h
  WHERE (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.bet_type
      AND rp.combination = h.selection
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.bet_type
      AND rp.combination = h.selection
      AND rp.returned = 0
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get() as { n: number };

  if ((row.n ?? 0) > 0) {
    throw new Error(
      `ROI_ALL_FEATURE_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.n} winning historical BUY ticket key(s) do not have exactly one positive non-refund official settlement`,
    );
  }

  console.log("[assert-roi-all-feature-settlement-integrity] PASS");
} finally {
  db.close();
}
