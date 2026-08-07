import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildResearchAutomationFailureHistory } from "./researchAutomationFailureHistory";
import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

const SHA = "a".repeat(40);
const IDEMPOTENCY = "b".repeat(64);

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-failure-history-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function history(overrides: Partial<Parameters<typeof buildResearchAutomationFailureHistory>[0]> = {}) {
  return buildResearchAutomationFailureHistory({
    runId: "40000000001",
    requestId: "REQ-test-failure",
    intentId: "INTENT-test-failure",
    taskId: "TASK-N2-FAILURE",
    taskType: "test-failure",
    safetyLevel: "L0",
    executorVersion: "test-executor-registry-v1",
    result: "FAILED",
    failureCode: "EXECUTOR_EXCEPTION",
    finalTaskStatus: "FAILED_RETRYABLE",
    message: "fixture failure",
    authoritySha: SHA,
    idempotencyKey: IDEMPOTENCY,
    startedAt: "2026-08-07T08:00:00.000Z",
    completedAt: "2026-08-07T08:00:01.000Z",
    elapsedMs: 1000,
    ...overrides,
  });
}

test("FAILED executor exception becomes strong durable negative evidence", () => {
  withRoot((root) => {
    const value = history();
    const dir = join(root, "reports/automation/history");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${value.runId}-${value.taskId}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    const report = buildResearchDurableKnowledgeCompletenessReport({
      repoRoot: root,
      generatedAt: "2026-08-07T08:05:00.000Z",
    });
    assert.equal(report.status, "PASS");
    assert.equal(report.invalidHistoryCount, 0);
    assert.equal(report.nonPassDurableHistoryCount, 1);
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 1);
    assert.deepEqual(report.runs[0]?.issues, []);
    assert.deepEqual(report.runs[0]?.warnings, []);
  });
});

test("BLOCKED missing executor becomes strong durable negative evidence", () => {
  withRoot((root) => {
    const value = history({
      result: "BLOCKED",
      failureCode: "EXECUTOR_NOT_REGISTERED",
      finalTaskStatus: "READY",
      message: null,
    });
    const dir = join(root, "reports/automation/history");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${value.runId}-${value.taskId}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.invalidHistoryCount, 0);
    assert.equal(report.nonPassDurableHistoryCount, 1);
    assert.equal(report.strongDurableCompleteCount, 1);
    assert.equal(report.runs[0]?.result, "BLOCKED");
  });
});

test("failure output digest is deterministic and message is bounded", () => {
  const longMessage = "x".repeat(1000);
  const a = history({ message: longMessage });
  const b = history({ message: longMessage });
  assert.equal(a.outputDigest, b.outputDigest);
  assert.match(a.outputDigest, /^[0-9a-f]{64}$/u);
  assert.equal(a.summary.message?.length, 300);
});

test("builder rejects malformed authority and empty failure code", () => {
  assert.throws(() => history({ authoritySha: "short" }), /FAILURE_HISTORY_AUTHORITY_SHA_INVALID/u);
  assert.throws(() => history({ failureCode: "" }), /FAILURE_HISTORY_FAILURE_CODE_INVALID/u);
});
