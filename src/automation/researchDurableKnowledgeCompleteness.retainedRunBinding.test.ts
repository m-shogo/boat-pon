import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

function writeText(root: string, relativePath: string, text: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function writeHistory(root: string, runId: string, outputPath: string): void {
  const value = {
    runId,
    requestId: `REQ-${runId}`,
    intentId: `INTENT-${runId}`,
    taskId: "TASK-N2-001",
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "fixture-executor-v1",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs: [outputPath],
    outputDigest: "a".repeat(64),
    summary: { status: "PASS" },
    authoritySha: "b".repeat(40),
    idempotencyKey: "c".repeat(64),
    startedAt: "2026-08-07T01:00:00.000Z",
    completedAt: "2026-08-07T01:00:01.000Z",
    elapsedMs: 1000,
  };
  writeText(
    root,
    `reports/automation/history/${runId}-TASK-N2-001.json`,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-durable-retained-run-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("durable audit accepts a canonical retained output bound to its own run", () => {
  withRoot((root) => {
    const content = "retained evidence\n";
    const digest = createHash("sha256").update(content).digest("hex");
    const retainedPath = `reports/automation/retained-outputs/2001/${digest}-evidence.txt`;
    writeText(root, retainedPath, content);
    writeHistory(root, "2001", retainedPath);

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.strongDurableCompleteCount, 1);
    assert.equal(report.runs[0].classification, "PASS_DURABLE_OUTPUTS");
    assert.equal(report.runs[0].outputs[0].integrity, "RETAINED_CONTENT_DIGEST_VERIFIED");
  });
});

test("durable audit rejects a retained output owned by a different run", () => {
  withRoot((root) => {
    const content = "retained evidence\n";
    const digest = createHash("sha256").update(content).digest("hex");
    const retainedPath = `reports/automation/retained-outputs/2002/${digest}-evidence.txt`;
    writeText(root, retainedPath, content);
    writeHistory(root, "2001", retainedPath);

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidHistoryCount, 1);
    assert.equal(report.runs[0].classification, "INVALID_HISTORY");
    assert.equal(report.runs[0].durableComplete, false);
    assert.deepEqual(report.runs[0].outputs, []);
    assert.match(report.runs[0].issues.join("\n"), /HISTORY_RETAINED_RUN_ID_MISMATCH/u);
  });
});
