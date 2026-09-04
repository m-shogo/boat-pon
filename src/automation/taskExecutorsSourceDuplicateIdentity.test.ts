import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveExecutor, type ExecutorContext } from "./taskExecutors";

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

function runDatasetExpand(sidecarPath: string) {
  const resolved = resolveExecutor("dataset-expand");
  assert.equal(resolved.code, "OK");
  assert.ok(resolved.executor);
  const root = join(sidecarPath, "..");
  const ctx: ExecutorContext = {
    repoRoot: root,
    runId: "run-test",
    requestId: "request-test",
    taskId: "TASK-N2-010",
    sidecarPath,
    historyDir: join(root, "history"),
    reportsDir: join(root, "reports"),
    dryRun: true,
    taskStatuses: { "TASK-N2-004": "PASS" },
  };
  return resolved.executor(ctx);
}

function assertIdentityBlocked(sidecarPath: string): void {
  const result = runDatasetExpand(sidecarPath);
  assert.equal(result.result, "BLOCKED");
  assert.deepEqual(result.blocks, ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);
  assert.deepEqual(result.outputs, []);
}

test("runtime source duplicate evidence rejects a leaf symlink sidecar before settlement preflight", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-source-duplicate-leaf-symlink-"));
  try {
    const target = join(root, "sidecar.sqlite");
    const alias = join(root, "sidecar-alias.sqlite");
    createDb(target);
    symlinkSync(target, alias);
    assertIdentityBlocked(alias);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime source duplicate evidence rejects an ancestor symlink sidecar before settlement preflight", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-source-duplicate-ancestor-symlink-"));
  try {
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    const target = join(realDir, "sidecar.sqlite");
    createDb(target);
    symlinkSync(realDir, aliasDir);
    assertIdentityBlocked(join(aliasDir, "sidecar.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime source duplicate evidence rejects a hardlinked sidecar before settlement preflight", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-source-duplicate-hardlink-"));
  try {
    const target = join(root, "sidecar.sqlite");
    const hardlink = join(root, "sidecar-hardlink.sqlite");
    createDb(target);
    linkSync(target, hardlink);
    assertIdentityBlocked(target);
    assertIdentityBlocked(hardlink);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
