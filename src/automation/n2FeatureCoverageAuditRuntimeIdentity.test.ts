import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runN2ActiveFeatureCoverageAudit } from "./n2FeatureCoverageAuditRuntime";

function createDb(path: string): void {
  const db = new DatabaseSync(path);
  db.close();
}

function run(sidecarPath: string) {
  return runN2ActiveFeatureCoverageAudit({
    repoRoot: join(sidecarPath, ".."),
    runId: "test-run",
    requestId: "test-request",
    taskId: "TASK-N2-006",
    sidecarPath,
    historyDir: join(sidecarPath, "..", "history"),
    reportsDir: join(sidecarPath, "..", "reports"),
    dryRun: true,
    taskStatuses: { "TASK-N2-004": "PASS" },
  });
}

function assertIdentityBlocked(sidecarPath: string): void {
  const result = run(sidecarPath);
  assert.equal(result.result, "BLOCKED");
  assert.ok(result.blocks.includes("SIDECAR_IDENTITY_INVALID"));
}

test("feature coverage audit rejects a leaf symlink sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-leaf-symlink-"));
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

test("feature coverage audit rejects an ancestor symlink sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-ancestor-symlink-"));
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

test("feature coverage audit rejects a hardlinked sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-hardlink-"));
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