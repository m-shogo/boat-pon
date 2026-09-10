/**
 * Fail-closed H011 forward-monitor entrypoint.
 * Research-only: no DB writes, production decisions, notifications, or betting.
 * Pending races may have zero exacta settlement rows; once a settlement exists it
 * must be exactly one positive, non-refund official exacta line before ROI/verdict
 * aggregation is allowed to run.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const MONITOR_START = process.env.H011_MONITOR_START ?? "2026-06-01";
const RUN_KIND = process.env.H011_RUN_KIND ?? "paper-live";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) throw new Error("H011_FORWARD_PRIMARY_DB_MISSING");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "H011_FORWARD_PRIMARY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");

type IntegrityRow = {
  population: number;
  pending: number;
  settled: number;
  ambiguous: number;
};

try {
  const placeholdersV = EXCL_VENUES.map(() => "?").join(",");
  const placeholdersR = EXCL_RACES.map(() => "?").join(",");
  const row = db.prepare(`
    WITH population AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY'
        AND dh.run_kind=?
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${placeholdersV})
        AND dh.race_no NOT IN (${placeholdersR})
        AND dh.selection='1-2-3'
        AND dh.date>=?
    ), settlement AS (
      SELECT p.race_id,
        COUNT(rp.race_id) AS line_count,
        SUM(CASE WHEN rp.race_id IS NOT NULL
          AND rp.returned=0
          AND rp.combination IS NOT NULL
          AND rp.combination!=''
          AND rp.payout_yen IS NOT NULL
          AND rp.payout_yen>0
        THEN 1 ELSE 0 END) AS valid_count
      FROM population p
      LEFT JOIN race_payouts rp
        ON rp.race_id=p.race_id AND rp.bet_type='exacta'
      GROUP BY p.race_id
    )
    SELECT
      COUNT(*) AS population,
      SUM(CASE WHEN line_count=0 THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN line_count=1 AND valid_count=1 THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN line_count>0 AND NOT (line_count=1 AND valid_count=1) THEN 1 ELSE 0 END) AS ambiguous
    FROM settlement
  `).get(RUN_KIND, ...EXCL_VENUES, ...EXCL_RACES, MONITOR_START) as IntegrityRow;

  const integrity = {
    population: Number(row?.population ?? 0),
    pending: Number(row?.pending ?? 0),
    settled: Number(row?.settled ?? 0),
    ambiguous: Number(row?.ambiguous ?? 0),
  };

  if (!Object.values(integrity).every(Number.isInteger)
    || integrity.population < 0
    || integrity.pending < 0
    || integrity.settled < 0
    || integrity.ambiguous < 0
    || integrity.pending + integrity.settled + integrity.ambiguous !== integrity.population
    || integrity.ambiguous !== 0) {
    throw new Error(`H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED ${JSON.stringify(integrity)}`);
  }

  console.log(`[h011-forward] settlement preflight PASS population=${integrity.population} settled=${integrity.settled} pending=${integrity.pending}`);
} finally {
  db.close();
}

if (!existsSync(DB_PATH)) throw new Error("H011_FORWARD_HANDOFF_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "H011_FORWARD_DB_HANDOFF_IDENTITY_INVALID",
);

const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/report-h011-forward-monitor-internal.ts"], {
  stdio: "inherit",
  env: { ...process.env, BOAT_PON_DB_PATH: handoffDbPath },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
