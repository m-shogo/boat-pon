import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retained-scanner-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function put(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}
function history(outputPath: string, outputDigest: string): Record<string, unknown> {
  return {
    runId: "12345", requestId: "REQ-12345", intentId: "INTENT-12345", taskId: "TASK-N2-TEST",
    taskType: "readonly-audit", safetyLevel: "L0", executorVersion: "fixture-v1", executed: true,
    result: "PASS", blocks: [], outputs: [outputPath], outputDigest, summary: { fixture: true },
    authoritySha: "1".repeat(40), idempotencyKey: "2".repeat(64),
    startedAt: "2026-08-07T00:00:00.000Z", completedAt: "2026-08-07T00:00:01.000Z", elapsedMs: 1000,
  };
}

test("content-addressed retained output is strong durable evidence", () => {
  withRoot((root) => {
    const outputDigest = "a".repeat(64);
    const content = JSON.stringify({ outputDigest, value: 1 }) + "\n";
    const outputPath = `reports/automation/retained-outputs/12345/${hash(content)}-example.json`;
    put(root, outputPath, content);
    put(root, "reports/automation/history/12345-TASK-N2-TEST.json", JSON.stringify(history(outputPath, outputDigest)) + "\n");
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.strongDurableCompleteCount, 1);
    assert.equal(report.runs[0]?.outputs[0]?.rootClass, "RETAINED");
    assert.equal(report.runs[0]?.outputs[0]?.integrity, "RETAINED_CONTENT_DIGEST_VERIFIED");
  });
});

test("content mismatch or embedded history digest mismatch fails closed", () => {
  withRoot((root) => {
    const outputDigest = "b".repeat(64);
    const original = JSON.stringify({ outputDigest, value: 1 }) + "\n";
    const contentPath = `reports/automation/retained-outputs/12345/${hash(original)}-content.json`;
    put(root, contentPath, JSON.stringify({ outputDigest, value: 2 }) + "\n");
    put(root, "reports/automation/history/12345-TASK-N2-TEST.json", JSON.stringify(history(contentPath, outputDigest)) + "\n");
    let report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.match(report.runs[0]?.issues[0] ?? "", /DURABLE_RETAINED_CONTENT_DIGEST_MISMATCH/u);

    rmSync(join(root, "reports/automation/history"), { recursive: true, force: true });
    const mismatched = JSON.stringify({ outputDigest: "c".repeat(64), value: 3 }) + "\n";
    const digestPath = `reports/automation/retained-outputs/12345/${hash(mismatched)}-digest.json`;
    put(root, digestPath, mismatched);
    put(root, "reports/automation/history/12345-TASK-N2-TEST.json", JSON.stringify(history(digestPath, outputDigest)) + "\n");
    report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.match(report.runs[0]?.issues[0] ?? "", /DURABLE_RETAINED_HISTORY_DIGEST_MISMATCH/u);
  });
});
