import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readCleanTrifectaWinners } from "./n2HistoricalOnlyBaselineSource";

function withSidecar(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-historical-raw-eligibility-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE raw_documents (
      raw_document_id TEXT PRIMARY KEY,
      integrity_status TEXT NOT NULL,
      security_scan_status TEXT NOT NULL,
      parser_replay_eligible INTEGER NOT NULL
    );
    CREATE TABLE parse_runs (
      parse_run_id TEXT PRIMARY KEY,
      raw_document_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE domain_observations (
      observation_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      observation_type TEXT NOT NULL,
      payload_type TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL
    );
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      supersedes_candidate_id TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_raw TEXT,
      selection_normalized TEXT,
      selection_canonical TEXT,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      resolution_id TEXT PRIMARY KEY,
      duplicate_observation_id TEXT NOT NULL,
      canonical_observation_id TEXT NOT NULL,
      canonical_race_key TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      source_archive_file TEXT NOT NULL,
      resolution_kind TEXT NOT NULL,
      detection_reason TEXT NOT NULL,
      duplicate_semantic_digest TEXT NOT NULL,
      resolver_version TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
  `);
  try { fn(path, db); }
  finally {
    try { db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertWinner(db: DatabaseSync, rawIntegrityStatus: string, rawSecurityScanStatus: string, parserReplayEligible: number): void {
  const raceKey = "2026-07-01:01:R1";
  db.prepare("INSERT INTO raw_documents VALUES ('raw-1', ?, ?, ?)")
    .run(rawIntegrityStatus, rawSecurityScanStatus, parserReplayEligible);
  db.prepare("INSERT INTO parse_runs VALUES ('parse-1','raw-1','success')").run();
  db.prepare(`INSERT INTO domain_observations VALUES
    ('obs-1',?,'settlement_result','settlement_result','raw-1','parse-1')`).run(raceKey);
  db.prepare(`INSERT INTO settlement_candidates_v2 VALUES
    ('cand-1',?,'trifecta','settled','normal','resolved','obs-1','parse-1','raw-1',NULL)`).run(raceKey);
  db.prepare(`INSERT INTO race_payout_lines_v2 VALUES
    ('payout-1','cand-1',1,'trifecta','1-2-3','1-2-3','1-2-3','payout')`).run();
}

test("historical winner reader rejects tainted raw evidence", () => {
  for (const evidence of [
    ["quarantined", "passed", 1],
    ["verified", "quarantined", 1],
    ["verified", "passed", 0],
  ] as const) {
    withSidecar((path, db) => {
      insertWinner(db, evidence[0], evidence[1], evidence[2]);
      db.close();
      const result = readCleanTrifectaWinners({
        sidecarDbPath: path,
        fromDate: "2026-07-01",
        toDate: "2026-07-01",
      });
      assert.deepEqual(result.rows, []);
      assert.deepEqual(result.blockers, ["2026-07-01:01:R1:SETTLEMENT_LINEAGE_MISMATCH:obs-1"]);
    });
  }
});

test("historical winner reader accepts verified replay-eligible raw evidence", () => {
  withSidecar((path, db) => {
    insertWinner(db, "verified", "passed", 1);
    db.close();
    const result = readCleanTrifectaWinners({
      sidecarDbPath: path,
      fromDate: "2026-07-01",
      toDate: "2026-07-01",
    });
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.rows, [{ canonicalRaceKey: "2026-07-01:01:R1", winningSelection: "1-2-3" }]);
  });
});