import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

function writeHistory(root: string, retainedPath: string): void {
  const value = {
    runId: "4001",
    requestId: "REQ-4001",
    intentId: "INTENT-4001",
    taskId: "TASK-N2-001",
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "fixture-executor-v1",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs: [retainedPath],
    outputDigest: "a".repeat(64),
    summary: { status: "PASS" },
    authoritySha: "b".repeat(40),
    idempotencyKey: "c".repeat(64),
    startedAt: "2026-08-07T01:00:00.000Z",
    completedAt: "2026-08-07T01:00:01.000Z",
    elapsedMs: 1000,
  };
  const path = join(root, "reports/automation/history/4001-TASK-N2-001.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("durable audit rejects retained evidence above the trusted 2 MiB ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-durable-retained-size-"));
  try {
    const content = "x".repeat(2_097_153);
    const digest = createHash("sha256").update(content).digest("hex");
    const retainedPath = `reports/automation/retained-outputs/4001/${digest}-evidence.txt`;
    const retainedAbsolute = join(root, retainedPath);
    mkdirSync(dirname(retainedAbsolute), { recursive: true });
    writeFileSync(retainedAbsolute, content, "utf8");
    writeHistory(root, retainedPath);

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidHistoryCount, 0);
    assert.equal(report.invalidOutputReferenceCount, 1);
    assert.equal(report.runs[0].classification, "INCOMPLETE_OUTPUT_REFERENCE");
    assert.equal(report.runs[0].durableComplete, false);
    assert.equal(report.runs[0].outputs[0].bytes, 2_097_153);
    assert.match(report.runs[0].outputs[0].issues.join("\n"), /DURABLE_OUTPUT_SIZE_INVALID/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
