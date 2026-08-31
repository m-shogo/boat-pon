import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { preflightN2DatasetCanarySettlementLineage } from "./n2DatasetCanarySettlementGuard";
import { resolveExecutor } from "./taskExecutors";

const FIXTURE_TIME = "2024-06-05T03:00:00.000Z";

test("canary runtime blocks an out-of-scope cross-race superseder before it can hide in-scope evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-canary-supersession-scope-"));
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
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
        parse_run_id TEXT NOT NULL
      );
      CREATE TABLE settlement_candidates_v2 (
        candidate_id TEXT PRIMARY KEY,
        canonical_race_key TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        settlement_status TEXT NOT NULL,
        result_kind TEXT NOT NULL,
        revision_kind TEXT NOT NULL,
        resolution_status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_schema_version TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        supersedes_candidate_id TEXT,
        correction_reason TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
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
        line_kind TEXT NOT NULL,
        created_at TEXT NOT NULL
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
        reason_code TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        duplicate_observation_id TEXT
      );
    `);
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      VALUES ('obs-a','2024-06-05:12:R1','settlement_result','settlement_result','raw-a','parse-a')`).run();
    db.prepare(`INSERT INTO settlement_candidates_v2 VALUES
      ('candidate-a','2024-06-05:12:R1','trifecta','settled','normal','initial','resolved','official','fixture-v1',
       'obs-a','parse-a','raw-a',?,NULL,NULL,?,?)`)
      .run("a".repeat(64), FIXTURE_TIME, FIXTURE_TIME);
    db.prepare(`INSERT INTO settlement_candidates_v2 VALUES
      ('cross-race-newer','2025-06-05:12:R1','trifecta','settled','normal','source_revision','resolved','official','fixture-v1',
       'obs-a','parse-a','raw-a',?,'candidate-a','fixture cross-race supersession',?,?)`)
      .run("b".repeat(64), FIXTURE_TIME, FIXTURE_TIME);
  } finally {
    db.close();
  }

  const block = "DATASET_CANARY_SETTLEMENT_SUPERSESSION_IDENTITY_INVALID:cross-race-newer";
  try {
    const checked = preflightN2DatasetCanarySettlementLineage(path);
    assert.equal(checked.ok, false);
    assert.equal(checked.checkedCandidateCount, 0);
    assert.deepEqual(checked.blocks, [block]);

    const resolved = resolveExecutor("dataset-canary");
    assert.equal(resolved.code, "OK");
    assert.ok(resolved.executor);
    const result = resolved.executor({
      repoRoot: root,
      runId: "run",
      requestId: "request",
      taskId: "TASK-N2-001",
      sidecarPath: path,
      historyDir: "history",
      reportsDir: "reports/n2",
      dryRun: true,
      taskStatuses: {},
    });
    assert.equal(result.result, "BLOCKED");
    assert.deepEqual(result.blocks, [block]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
