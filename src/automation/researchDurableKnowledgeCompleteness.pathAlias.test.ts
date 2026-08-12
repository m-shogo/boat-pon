import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

function writeJson(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function history(runId: string, output: string): Record<string, unknown> {
  return {
    runId,
    requestId: `REQ-${runId}`,
    intentId: `INTENT-${runId}`,
    taskId: `TASK-N2-${runId}`,
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
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
  };
}

test("durable audit rejects dot, empty-segment, and trailing-slash output aliases", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-durable-path-alias-"));
  try {
    writeJson(root, "reports/n2/example.json", { outputDigest: "a".repeat(64) });
    const aliases = [
      "reports/n2/./example.json",
      "reports/n2//example.json",
      "reports/n2/example.json/",
    ];
    aliases.forEach((output, index) => {
      const runId = String(2001 + index);
      const value = history(runId, output);
      writeJson(root, `reports/automation/history/${runId}-TASK-N2-${runId}.json`, value);
    });

    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidHistoryCount, aliases.length);
    for (const run of report.runs) {
      assert.equal(run.classification, "INVALID_HISTORY");
      assert.match(run.issues.join("\n"), /HISTORY_OUTPUT_PATH_NOT_APPROVED/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
