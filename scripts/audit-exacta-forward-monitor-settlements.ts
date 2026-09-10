/** Read-only preflight for the frozen exacta future monitor. */
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const LOCK_PATH = "data/exacta-forward-candidates.json";
if (!existsSync(DB_PATH)) throw new Error("EXACTA_FORWARD_MONITOR_DB_UNAVAILABLE");
if (!existsSync(LOCK_PATH)) throw new Error("EXACTA_FORWARD_MONITOR_LOCK_UNAVAILABLE");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "EXACTA_FORWARD_MONITOR_DB_IDENTITY_INVALID");
const verifiedLockPath = assertCanonicalSingleLinkRegularFile(LOCK_PATH, "EXACTA_FORWARD_MONITOR_LOCK_IDENTITY_INVALID");
const lock = JSON.parse(readFileSync(verifiedLockPath, "utf8")) as {
  lockedAt: string;
  basePopulation: { runKind: string; decision: string; selection: string; excludedVenues: string[]; excludedRaceNos: number[] };
};
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const venues = lock.basePopulation.excludedVenues.map(() => "?").join(",");
  const raceNos = lock.basePopulation.excludedRaceNos.map(() => "?").join(",");
  const params = [lock.basePopulation.runKind, lock.basePopulation.decision, lock.basePopulation.selection, lock.lockedAt, ...lock.basePopulation.excludedVenues, ...lock.basePopulation.excludedRaceNos];
  const targetRows = `
    SELECT dh.race_id, dh.bet_type, dh.returned
    FROM decision_history dh
    WHERE dh.run_kind = ? AND dh.decision = ? AND dh.selection = ?
      AND dh.current_odds IS NOT NULL AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.date >= ? AND dh.venue NOT IN (${venues}) AND dh.race_no NOT IN (${raceNos})
      AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND (re.status_code LIKE 'F%' OR re.status_code LIKE 'L%'))`;

  const drift = db.prepare(`SELECT COUNT(*) AS n FROM (${targetRows}) t WHERE t.bet_type IS NULL OR t.bet_type != '3連単' OR t.returned IS NULL OR t.returned != 0`).get(...params) as { n: number };
  if ((drift.n ?? 0) > 0) throw new Error("EXACTA_FORWARD_MONITOR_DECISION_COHORT_INVALID");

  const invalidSettlement = db.prepare(`
    WITH target_races AS (SELECT DISTINCT race_id FROM (${targetRows}))
    SELECT COUNT(*) AS n
    FROM race_payouts rp JOIN target_races tr ON tr.race_id=rp.race_id
    WHERE rp.bet_type='exacta' AND (rp.returned IS NULL OR rp.returned != 0)
  `).get(...params) as { n: number };
  if ((invalidSettlement.n ?? 0) > 0) throw new Error("EXACTA_FORWARD_MONITOR_SETTLEMENT_RETURN_INVALID");

  const ambiguousSettlement = db.prepare(`
    WITH target_races AS (SELECT DISTINCT race_id FROM (${targetRows})),
    exacta_lines AS (
      SELECT
        tr.race_id,
        COUNT(rp.race_id) AS line_count,
        SUM(CASE WHEN rp.race_id IS NOT NULL
          AND rp.returned = 0
          AND rp.combination IS NOT NULL
          AND rp.combination != ''
          AND rp.payout_yen IS NOT NULL
          AND rp.payout_yen > 0
        THEN 1 ELSE 0 END) AS valid_count
      FROM target_races tr
      LEFT JOIN race_payouts rp
        ON rp.race_id = tr.race_id AND rp.bet_type='exacta'
      GROUP BY tr.race_id
    )
    SELECT COUNT(*) AS n
    FROM exacta_lines
    WHERE line_count > 0
      AND (line_count != 1 OR valid_count != 1)
  `).get(...params) as { n: number };
  if ((ambiguousSettlement.n ?? 0) > 0) {
    throw new Error("EXACTA_FORWARD_MONITOR_SETTLEMENT_LINE_INTEGRITY_INVALID");
  }

  console.log("[exacta-forward-monitor-preflight] PASS: locked decision cohort and exacta settlement return/line integrity are valid");
} finally {
  db.close();
}