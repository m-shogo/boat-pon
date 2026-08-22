import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveExecutor, type ExecutorContext } from "./taskExecutors";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-core-duplicate-evidence-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createStaleResolutionSidecar(root: string): string {
  const path = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      resolution_id TEXT NOT NULL,
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
  db.prepare(`
    INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "resolution-stale",
    "duplicate-observation",
    "canonical-observation",
    "2026-08-01:01:R1",
    "raw-document",
    "k260801.lzh",
    "source_duplicate",
    "intra_file_source_duplicate: same raw document produced multiple identical race observations",
    "a".repeat(64),
    "stale-resolver-version",
    "n1c-source-duplicate-policy-v1",
    "n1-canonical-resolution-v2",
  );
  db.close();
  return path;
}

test("runtime dataset-expand fails closed on stale source-duplicate resolution evidence", () => {
  withRoot((root) => {
    const sidecarPath = createStaleResolutionSidecar(root);
    const resolved = resolveExecutor("dataset-expand");
    assert.equal(resolved.code, "OK");
    assert.ok(resolved.executor);

    const ctx: ExecutorContext = {
      repoRoot: root,
      runId: "run-test",
      requestId: "request-test",
      taskId: "TASK-N2-010",
      sidecarPath,
      historyDir: join(root, "history"),
      reportsDir: join(root, "reports"),
      dryRun: false,
      taskStatuses: { "TASK-N2-004": "PASS" },
    };
    const result = resolved.executor(ctx);
    assert.equal(result.result, "BLOCKED");
    assert.deepEqual(result.blocks, ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);
    assert.deepEqual(result.outputs, []);
  });
});
