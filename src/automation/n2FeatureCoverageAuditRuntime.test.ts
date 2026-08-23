import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveExecutor, type ExecutorContext } from "./taskExecutors";

function withSidecar(fn: (path: string, db: DatabaseSync) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-active-"));
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
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL
    );
    CREATE TABLE race_refund_lines_v2 (
      refund_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL
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
  try {
    fn(path, db);
  } finally {
    try { db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertCandidate(
  db: DatabaseSync,
  input: {
    id: string;
    raceKey: string;
    status: "settled" | "refunded";
    supersedes?: string | null;
    integrity?: string;
  },
): void {
  const rawId = `raw-${input.id}`;
  const parseId = `parse-${input.id}`;
  const observationId = `obs-${input.id}`;
  db.prepare("INSERT INTO raw_documents VALUES (?,?, 'passed', 1)")
    .run(rawId, input.integrity ?? "verified");
  db.prepare("INSERT INTO parse_runs VALUES (?,?, 'success')").run(parseId, rawId);
  db.prepare("INSERT INTO domain_observations VALUES (?,?, 'settlement_result','settlement_result',?,?)")
    .run(observationId, input.raceKey, rawId, parseId);
  db.prepare("INSERT INTO settlement_candidates_v2 VALUES (?,?, 'trifecta',?, 'normal',?,?,?,?)")
    .run(input.id, input.raceKey, input.status, observationId, parseId, rawId, input.supersedes ?? null);
}

function context(sidecarPath: string): ExecutorContext {
  return {
    repoRoot: mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-context-")),
    runId: "test-run",
    requestId: "test-request",
    taskId: "TASK-N2-006",
    sidecarPath,
    historyDir: "history",
    reportsDir: "reports/n2",
    dryRun: true,
    taskStatuses: { "TASK-N2-004": "PASS" },
  };
}

test("runtime feature coverage uses active settlement semantics", () => {
  withSidecar((path, db) => {
    insertCandidate(db, { id: "old", raceKey: "2024-01-01:01:R1", status: "settled" });
    insertCandidate(db, { id: "new", raceKey: "2024-01-01:01:R1", status: "settled", supersedes: "old" });
    insertCandidate(db, { id: "refund", raceKey: "2024-01-01:01:R2", status: "refunded" });
    db.prepare("INSERT INTO race_payout_lines_v2 VALUES ('payout-old','old')").run();
    db.prepare("INSERT INTO race_payout_lines_v2 VALUES ('payout-new','new')").run();
    db.prepare("INSERT INTO race_refund_lines_v2 VALUES ('refund-line','refund')").run();
    db.close();

    const resolved = resolveExecutor("feature-coverage-audit");
    assert.equal(resolved.code, "OK");
    assert.ok(resolved.executor);
    const result = resolved.executor(context(path));
    assert.equal(result.result, "PASS");
    assert.equal(result.summary.auditContractVersion, "n2-settlement-coverage-v2-active");
    assert.equal(result.summary.settledCandidates, 1);
    assert.equal(result.summary.settledWithPayoutLines, 1);
    assert.equal(result.summary.refundedCandidates, 1);
    assert.equal(result.summary.refundedWithRefundLines, 1);
    assert.equal(result.summary.activeSettlementSemantics, true);
  });
});

test("runtime feature coverage blocks tainted active settlement lineage", () => {
  withSidecar((path, db) => {
    insertCandidate(db, {
      id: "tainted",
      raceKey: "2024-01-01:01:R1",
      status: "settled",
      integrity: "quarantined",
    });
    db.prepare("INSERT INTO race_payout_lines_v2 VALUES ('payout-tainted','tainted')").run();
    db.close();

    const resolved = resolveExecutor("feature-coverage-audit");
    assert.equal(resolved.code, "OK");
    assert.ok(resolved.executor);
    const result = resolved.executor(context(path));
    assert.equal(result.result, "BLOCKED");
    assert.deepEqual(result.blocks, ["DATASET_ACTIVE_SETTLEMENT_LINEAGE_INVALID:tainted"]);
  });
});
