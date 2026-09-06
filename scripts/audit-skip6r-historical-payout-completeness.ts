import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FORWARD_START = "2025-01-01";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];

function q(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
const exclVenues = EXCL_VENUES.map(q).join(",");
const exclRaces = EXCL_RACES.join(",");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const row = db.prepare(`
    WITH population AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
        AND dh.result IS NOT NULL AND dh.result != ''
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${exclVenues})
        AND dh.race_no NOT IN (${exclRaces})
        AND dh.selection='1-2-3'
        AND dh.date >= '${FORWARD_START}'
    ), settled AS (
      SELECT DISTINCT rp.race_id
      FROM race_payouts rp
      WHERE rp.bet_type='trifecta'
        AND rp.payout_yen IS NOT NULL
        AND rp.payout_yen > 0
    )
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN s.race_id IS NOT NULL THEN 1 ELSE 0 END) AS settled
    FROM population p
    LEFT JOIN settled s ON s.race_id = p.race_id
  `).get() as { total: number; settled: number | null };

  const total = Number(row.total ?? 0);
  const settled = Number(row.settled ?? 0);
  const missing = total - settled;
  console.log(JSON.stringify({ total, settled, missing }));
  if (!Number.isInteger(total) || !Number.isInteger(settled) || total <= 0 || settled !== total) {
    console.error(`SKIP6R_HISTORICAL_PAYOUT_COVERAGE_INCOMPLETE total=${total} settled=${settled} missing=${missing}`);
    process.exitCode = 2;
  }
} finally {
  db.close();
}
