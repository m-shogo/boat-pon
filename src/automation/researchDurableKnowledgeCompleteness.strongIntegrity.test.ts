import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-durable-strong-integrity-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function writeText(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeHistory(root: string, runId: string, output: string): void {
  const taskId = `TASK-N2-${runId}`;
  writeText(root, `reports/automation/history/${runId}-${taskId}.json`, `${JSON.stringify({
    runId,
    requestId: `REQ-${runId}`,
    intentId: `INTENT-${runId}`,
    taskId,
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "fixture-executor-v1",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs: [output],
    outputDigest: "a".repeat(64),
    summary: { status: "PASS" },
    authoritySha: "b".repeat(40),
    idempotencyKey: "c".repeat(64),
    startedAt: "2026-08-11T01:00:00.000Z",
    completedAt: "2026-08-11T01:00:01.000Z",
    elapsedMs: 1000,
  }, null, 2)}\n`);
}

test("plain text output is durable but not strong without digest binding", () => {
  withRoot((root) => {
    writeText(root, "reports/n2/example.txt", "research evidence\n");
    writeHistory(root, "1101", "reports/n2/example.txt");

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });

    assert.equal(report.status, "PASS");
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 0);
    assert.equal(report.runs[0].durableComplete, true);
    assert.equal(report.runs[0].strongDurableComplete, false);
    assert.equal(report.runs[0].outputs[0].integrity, "TEXT_PRESENT");
  });
});

test("JSON without outputDigest is durable but not strong", () => {
  withRoot((root) => {
    writeText(root, "reports/n2/example.json", `${JSON.stringify({ reportVersion: "v1" })}\n`);
    writeHistory(root, "1102", "reports/n2/example.json");

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });

    assert.equal(report.status, "PASS");
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 0);
    assert.equal(report.runs[0].durableComplete, true);
    assert.equal(report.runs[0].strongDurableComplete, false);
    assert.equal(report.runs[0].outputs[0].integrity, "JSON_PRESENT_NO_OUTPUT_DIGEST");
  });
});
