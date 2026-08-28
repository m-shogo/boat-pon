import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { preflightN2DatasetCanarySettlementLineage } from "./n2DatasetCanarySettlementGuard";
import { resolveExecutor } from "./taskExecutors";

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
        observation_id TEXT NOT NULL,
        parse_run_id TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        supersedes_candidate_id TEXT
      );
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        duplicate_observation_id TEXT
      );
    `);
    db.prepare("INSERT INTO raw_documents VALUES ('raw-a','verified','passed',1)").run();
    db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
    db.prepare(`INSERT INTO domain_observations
      VALUES ('obs-a','2024-06-05:12:R1','settlement_result','settlement_result','raw-a','parse-a')`).run();
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('candidate-a','2024-06-05:12:R1','trifecta','settled','normal','obs-a','parse-a','raw-a',NULL)`).run();
    db.prepare(`INSERT INTO settlement_candidates_v2
      VALUES ('cross-race-newer','2025-06-05:12:R1','trifecta','settled','normal','obs-a','parse-a','raw-a','candidate-a')`).run();
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
