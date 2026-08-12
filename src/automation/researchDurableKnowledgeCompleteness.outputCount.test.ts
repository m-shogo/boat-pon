import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

function writeHistory(root: string, outputs: string[]): void {
  const value = {
    runId: "3001",
    requestId: "REQ-3001",
    intentId: "INTENT-3001",
    taskId: "TASK-N2-001",
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "fixture-executor-v1",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs,
    outputDigest: "a".repeat(64),
    summary: { status: "PASS" },
    authoritySha: "b".repeat(40),
    idempotencyKey: "c".repeat(64),
    startedAt: "2026-08-07T01:00:00.000Z",
    completedAt: "2026-08-07T01:00:01.000Z",
    elapsedMs: 1000,
  };
  const path = join(root, "reports/automation/history/3001-TASK-N2-001.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("durable audit rejects histories exceeding the trusted 64-output ceiling before output reads", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-durable-output-count-"));
  try {
    writeHistory(root, Array.from({ length: 65 }, (_, index) => `reports/n2/output-${index}.txt`));

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidHistoryCount, 1);
    assert.equal(report.runs[0].classification, "INVALID_HISTORY");
    assert.equal(report.runs[0].outputCount, 65);
    assert.deepEqual(report.runs[0].outputs, []);
    assert.match(report.runs[0].issues.join("\n"), /HISTORY_OUTPUT_COUNT_EXCEEDED/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
