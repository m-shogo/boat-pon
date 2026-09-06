/**
 * Fail-closed payout completeness preflight for the condB historical-closing-odds switch study.
 *
 * Research-only: read-only DB access, no app_settings changes, no production decision changes,
 * no betting/login/site operations, and no private T-5 path/value exposure.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FORWARD_START = "2025-01-01";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[condb-payout-preflight] primary database is unavailable");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "CONDB_SWITCH_HISTORICAL_PAYOUT_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const venuePlaceholders = EXCL_VENUES.map(() => "?").join(",");
  const racePlaceholders = EXCL_RACES.map(() => "?").join(",");
  const row = db.prepare(`
    WITH target AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision = 'BUY'
        AND dh.run_kind = 'historical-backfill'
        AND dh.result IS NOT NULL
        AND dh.result != ''
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${venuePlaceholders})
        AND dh.race_no NOT IN (${racePlaceholders})
        AND dh.selection = '1-2-3'
        AND dh.date >= ?
    ), settled AS (
      SELECT DISTINCT rp.race_id
      FROM race_payouts rp
      WHERE rp.bet_type = 'trifecta'
        AND rp.payout_yen IS NOT NULL
        AND rp.payout_yen > 0
    )
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN settled.race_id IS NOT NULL THEN 1 ELSE 0 END) AS covered
    FROM target
    LEFT JOIN settled ON settled.race_id = target.race_id
  `).get(...EXCL_VENUES, ...EXCL_RACES, FORWARD_START) as { total: number; covered: number };

  const total = Number(row.total ?? 0);
  const covered = Number(row.covered ?? 0);
  const missing = total - covered;

  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(covered) || total <= 0 || covered < 0 || covered > total) {
    console.error("[condb-payout-preflight] invalid settlement coverage state");
    process.exit(2);
  }

  if (missing !== 0) {
    console.error(`[condb-payout-preflight] incomplete official trifecta settlement coverage: covered=${covered}/${total}, missing=${missing}`);
    process.exit(2);
  }

  console.log(`[condb-payout-preflight] PASS official trifecta settlement coverage=${covered}/${total}`);
} finally {
  db.close();
}
