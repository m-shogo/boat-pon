import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveExecutor, type ExecutorContext } from "./taskExecutors";
import {
  preflightN2AllActiveSettlementLineage,
  preflightN2DatasetCanarySettlementLineage,
} from "./n2DatasetCanarySettlementGuard";

function withSidecar(
  raw: { integrity: string; security: string; replayEligible: number },
  fn: (path: string) => void,
  raceKey = "2024-06-05:12:R1",
): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-dataset-canary-lineage-"));
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
      observation_id TEXT NOT NULL,
      parse_run_id TEXT NOT NULL,
      raw_document_id TEXT NOT NULL,
      supersedes_candidate_id TEXT
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      duplicate_observation_id TEXT
    );
  `);
  db.prepare("INSERT INTO raw_documents VALUES ('raw-a',?,?,?)")
    .run(raw.integrity, raw.security, raw.replayEligible);
  db.prepare("INSERT INTO parse_runs VALUES ('parse-a','raw-a','success')").run();
  db.prepare(`INSERT INTO domain_observations
    VALUES ('obs-a',?,'settlement_result','settlement_result','raw-a','parse-a')`).run(raceKey);
  db.prepare(`INSERT INTO settlement_candidates_v2
    VALUES ('candidate-a',?,'trifecta','settled','normal','obs-a','parse-a','raw-a',NULL)`).run(raceKey);
  db.close();
  try {
    fn(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function context(sidecarPath: string): ExecutorContext {
  return {
    repoRoot: mkdtempSync(join(tmpdir(), "boat-pon-dataset-canary-context-")),
    runId: "test-run",
    requestId: "test-request",
    taskId: "TASK-N2-001",
    sidecarPath,
    historyDir: "history",
    reportsDir: "reports/n2",
    dryRun: true,
    taskStatuses: {},
  };
}

test("dataset canary preflight accepts verified active settlement lineage", () => {
  withSidecar({ integrity: "verified", security: "passed", replayEligible: 1 }, (path) => {
    const result = preflightN2DatasetCanarySettlementLineage(path);
    assert.equal(result.ok, true);
    assert.equal(result.checkedCandidateCount, 1);
    assert.deepEqual(result.blocks, []);
  });
});

test("runtime dataset canary fails closed on tainted active settlement lineage", () => {
  for (const raw of [
    { integrity: "quarantined", security: "passed", replayEligible: 1 },
    { integrity: "verified", security: "quarantined", replayEligible: 1 },
    { integrity: "verified", security: "passed", replayEligible: 0 },
  ]) {
    withSidecar(raw, (path) => {
      const resolved = resolveExecutor("dataset-canary");
      assert.equal(resolved.code, "OK");
      assert.ok(resolved.executor);
      const result = resolved.executor(context(path));
      assert.equal(result.result, "BLOCKED");
      assert.deepEqual(result.blocks, ["DATASET_CANARY_SETTLEMENT_LINEAGE_INVALID:candidate-a"]);
    });
  }
});

test("all-active preflight catches tainted settlements outside the canary month", () => {
  withSidecar(
    { integrity: "quarantined", security: "passed", replayEligible: 1 },
    (path) => {
      const checked = preflightN2AllActiveSettlementLineage(path);
      assert.equal(checked.ok, false);
      assert.deepEqual(checked.blocks, ["DATASET_ACTIVE_SETTLEMENT_LINEAGE_INVALID:candidate-a"]);

      for (const taskType of ["dataset-inventory", "dataset-expand", "readonly-analysis", "readonly-audit"]) {
        const resolved = resolveExecutor(taskType);
        assert.equal(resolved.code, "OK");
        assert.ok(resolved.executor);
        const result = resolved.executor(context(path));
        assert.equal(result.result, "BLOCKED");
        assert.deepEqual(result.blocks, ["DATASET_ACTIVE_SETTLEMENT_LINEAGE_INVALID:candidate-a"]);
      }
    },
    "2020-06-05:12:R1",
  );
});
