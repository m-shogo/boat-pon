import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory } from "./researchDurableKnowledgeRetainedInventory";

const AUTHORITY_SHA = "a".repeat(40);
const IDEMPOTENCY_KEY = "b".repeat(64);
const HISTORY_OUTPUT_DIGEST = "c".repeat(64);

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-inventory-integration-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function retained(root: string, runId: string, basename: string, content: string): string {
  const digest = createHash("sha256").update(content).digest("hex");
  const relativePath = `reports/automation/retained-outputs/${runId}/${digest}-${basename}`;
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return relativePath;
}

function history(root: string, input: { runId: string; outputPath: string }): void {
  const relativePath = `reports/automation/history/${input.runId}-TASK-N2-011.json`;
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    runId: input.runId,
    requestId: `REQ-${input.runId}`,
    intentId: `INTENT-${input.runId}`,
    taskId: "TASK-N2-011",
    taskType: "pit-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs: [input.outputPath],
    outputDigest: HISTORY_OUTPUT_DIGEST,
    summary: { fixture: true },
    authoritySha: AUTHORITY_SHA,
    idempotencyKey: IDEMPOTENCY_KEY,
    startedAt: "2026-08-07T00:00:00.000Z",
    completedAt: "2026-08-07T00:00:01.000Z",
    elapsedMs: 1000,
  }, null, 2)}\n`, "utf8");
}

test("retained root with no history is BLOCKED as orphan evidence", () => {
  withRoot((root) => {
    retained(root, "123", "report.txt", "retained evidence\n");
    const report = buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.historyFileCount, 0);
    assert.equal(report.retainedOutputFileCount, 1);
    assert.equal(report.referencedRetainedOutputCount, 0);
    assert.equal(report.orphanRetainedOutputCount, 1);
    assert.equal(report.invalidRetainedOutputCount, 0);
  });
});

test("same-run history reference accounts for retained evidence", () => {
  withRoot((root) => {
    const outputPath = retained(root, "123", "report.txt", "retained evidence\n");
    history(root, { runId: "123", outputPath });
    const report = buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 1);
    assert.equal(report.retainedOutputFileCount, 1);
    assert.equal(report.referencedRetainedOutputCount, 1);
    assert.equal(report.orphanRetainedOutputCount, 0);
    assert.equal(report.invalidRetainedOutputCount, 0);
  });
});

test("unreferenced retained file blocks an otherwise valid history", () => {
  withRoot((root) => {
    const outputPath = retained(root, "123", "report.txt", "retained evidence\n");
    history(root, { runId: "123", outputPath });
    retained(root, "124", "orphan.txt", "orphan evidence\n");
    const report = buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.retainedOutputFileCount, 2);
    assert.equal(report.referencedRetainedOutputCount, 1);
    assert.equal(report.orphanRetainedOutputCount, 1);
    assert.equal(report.invalidRetainedOutputCount, 0);
  });
});

test("tampered retained file is counted invalid and blocks audit", () => {
  withRoot((root) => {
    const expectedDigest = createHash("sha256").update("original\n").digest("hex");
    const outputPath = `reports/automation/retained-outputs/123/${expectedDigest}-report.txt`;
    const absolutePath = join(root, outputPath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, "tampered\n", "utf8");
    history(root, { runId: "123", outputPath });
    const report = buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidRetainedOutputCount, 1);
    assert.equal(report.orphanRetainedOutputCount, 0);
    assert.equal(report.invalidOutputReferenceCount, 1);
  });
});

test("existing history without retained outputs keeps zero inventory counts", () => {
  withRoot((root) => {
    const mutable = "reports/n2/report.txt";
    const absolute = join(root, mutable);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, "mutable evidence\n", "utf8");
    history(root, { runId: "123", outputPath: mutable });
    const report = buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory({ repoRoot: root });
    assert.equal(report.retainedOutputFileCount, 0);
    assert.equal(report.retainedOutputBytes, 0);
    assert.equal(report.referencedRetainedOutputCount, 0);
    assert.equal(report.orphanRetainedOutputCount, 0);
    assert.equal(report.invalidRetainedOutputCount, 0);
  });
});
