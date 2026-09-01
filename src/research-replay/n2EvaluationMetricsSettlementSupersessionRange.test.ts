import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2EvaluationMetricsSettlements } from "./n2EvaluationMetricsSettlementReader";

test("evaluation metrics validates supersession identity when the requested race is the successor", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-metrics-supersession-range-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  const requestedRaceKey = "2026-08-07:05:R1";
  try {
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
        parse_run_id TEXT NOT NULL,
        supersedes_id TEXT,
        correction_kind TEXT,
        correction_reason TEXT
      );
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT
      );
      CREATE TABLE race_payout_lines_v2 (
        payout_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT NOT NULL,
        selection_normalized TEXT NOT NULL,
        selection_canonical TEXT,
        payout_yen INTEGER NOT NULL,
        popularity INTEGER,
        line_kind TEXT NOT NULL
      );
      CREATE TABLE race_refund_lines_v2 (
        refund_line_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        bet_type TEXT NOT NULL,
        selection_raw TEXT,
        selection_normalized TEXT,
        selection_canonical TEXT,
        refund_scope TEXT NOT NULL,
        refund_yen_per_100 INTEGER,
        reason_code TEXT NOT NULL
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
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('outside-prior','2026-08-06:04:R1','trifecta','settled','normal','initial','resolved','obs-a','parse-a','raw-a',?,NULL,NULL)`).run("a".repeat(64));
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('requested-newer',?,'trifecta','settled','normal','correction','resolved','obs-a','parse-a','raw-a',?,'outside-prior','synthetic-cross-race')`).run(
      requestedRaceKey,
      "b".repeat(64),
    );
  } finally {
    db.close();
  }

  try {
    const report = readN2EvaluationMetricsSettlements({
      sidecarDbPath: path,
      raceKeys: [requestedRaceKey],
    });
    assert.equal(report.status, "BLOCKED");
    assert.deepEqual(report.blockers, [
      `${requestedRaceKey}:SETTLEMENT_SUPERSESSION_IDENTITY_INVALID:requested-newer`,
    ]);
    assert.equal(report.settlementCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
