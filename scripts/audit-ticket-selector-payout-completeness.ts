/**
 * audit-ticket-selector-payout-completeness.ts — research-only/read-only
 *
 * Ticket-selector research compares trifecta, trio, exacta, quinella, and wide
 * returns. Missing settlement rows for any compared market must not be treated
 * as zero-return races when choosing the best train/forward strategy.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];
const BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;

if (!existsSync(DB_PATH)) {
  console.error("[ticket-selector-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "ticket selector primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type CoverageRow = {
  total: number;
  cov_trifecta: number;
  cov_trio: number;
  cov_exacta: number;
  cov_quinella: number;
  cov_wide: number;
};

try {
  const excludedVenues = EXCLUDED_VENUES.map(() => "?").join(",");
  const excludedRaceNos = EXCLUDED_RACE_NOS.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta') THEN 1 ELSE 0 END) AS cov_trifecta,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio') THEN 1 ELSE 0 END) AS cov_trio,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta') THEN 1 ELSE 0 END) AS cov_exacta,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella') THEN 1 ELSE 0 END) AS cov_quinella,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide') THEN 1 ELSE 0 END) AS cov_wide
    FROM decision_history dh
    WHERE dh.decision='BUY'
      AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.current_odds IS NOT NULL
      AND dh.venue NOT IN (${excludedVenues})
      AND dh.race_no NOT IN (${excludedRaceNos})
      AND dh.selection='1-2-3'
  `).get(...EXCLUDED_VENUES, ...EXCLUDED_RACE_NOS) as CoverageRow;

  const total = Number(row.total ?? 0);
  let complete = total > 0;
  console.log(`[ticket-selector-preflight] population=${total}`);

  for (const betType of BET_TYPES) {
    const covered = Number(row[`cov_${betType}` as keyof CoverageRow] ?? 0);
    const missing = Math.max(0, total - covered);
    const pct = total > 0 ? Math.round((covered / total) * 10000) / 100 : 0;
    console.log(`[ticket-selector-preflight] ${betType}: covered=${covered}/${total} (${pct}%) missing=${missing}`);
    if (covered !== total) complete = false;
  }

  if (!complete) {
    console.error("[ticket-selector-preflight] FAIL: compared-market settlement coverage is incomplete; selector ROI/best-strategy verdicts must remain unavailable");
    process.exit(2);
  }

  console.log("[ticket-selector-preflight] PASS: all compared payout markets have complete coverage for the selector population");
} finally {
  db.close();
}
