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
// Keep cohort and settlement integrity checks on one append-only research snapshot.
db.exec("BEGIN;");

try {
  const contamination = db.prepare(`
    SELECT COUNT(*) AS invalid
    FROM decision_history dh
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.current_odds IS NOT NULL
      AND dh.venue NOT IN (${exclVenues})
      AND dh.race_no NOT IN (${exclRaces})
      AND dh.selection='1-2-3'
      AND dh.date >= '${FORWARD_START}'
      AND (dh.bet_type != '3連単' OR dh.returned IS NULL OR dh.returned != 0)
  `).get() as { invalid: number | bigint | null };
  const invalid = Number(contamination.invalid ?? 0);
  if (!Number.isSafeInteger(invalid) || invalid < 0 || invalid > 0) {
    console.error(`SKIPVENUE_HISTORICAL_COHORT_INVALID invalid=${invalid}`);
    process.exitCode = 2;
  } else {
    const payoutReturnState = db.prepare(`
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
          AND dh.bet_type='3連単'
          AND dh.returned=0
      )
      SELECT COUNT(*) AS invalid
      FROM race_payouts rp
      JOIN population p ON p.race_id = rp.race_id
      WHERE rp.bet_type='trifecta'
        AND (rp.returned IS NULL OR rp.returned != 0)
    `).get() as { invalid: number | bigint | null };
    const invalidPayoutReturnState = Number(payoutReturnState.invalid ?? 0);
    if (!Number.isSafeInteger(invalidPayoutReturnState) || invalidPayoutReturnState < 0 || invalidPayoutReturnState > 0) {
      console.error(`SKIPVENUE_HISTORICAL_PAYOUT_RETURN_STATE_INVALID invalid=${invalidPayoutReturnState}`);
      process.exit(2);
    }

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
          AND dh.bet_type='3連単'
          AND dh.returned=0
      ), settled AS (
        SELECT rp.race_id
        FROM race_payouts rp
        WHERE rp.bet_type='trifecta'
          AND rp.returned=0
        GROUP BY rp.race_id
        HAVING COUNT(*) >= 1
          AND COUNT(DISTINCT rp.combination) = COUNT(*)
          AND SUM(CASE WHEN rp.payout_yen IS NOT NULL AND rp.payout_yen > 0 THEN 1 ELSE 0 END) = COUNT(*)
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
      console.error(`SKIPVENUE_HISTORICAL_PAYOUT_COVERAGE_INCOMPLETE total=${total} settled=${settled} missing=${missing}`);
      process.exitCode = 2;
    }
  }
} finally {
  db.close();
}