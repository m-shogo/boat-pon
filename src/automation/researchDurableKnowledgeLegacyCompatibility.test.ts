import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility,
  countAttestedLegacyDurableRuns,
} from "./researchDurableKnowledgeLegacyCompatibility";

const HISTORY_PATH = "reports/automation/history/30878594429-TASK-N2-003.json";
const OUTPUT_PATH = "reports/n2/n2-win-refund-omission-audit.json";
const OUTPUT_DIGEST = "bd4bed76312255dd5434dc9668346ecb139934b05df2c48d86e8bece781987aa";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-legacy-durable-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function legacySummary(): Record<string, unknown> {
  return {
    heldOutCount: 2,
    proposedDefectCode: "V1_WIN_REFUND_OMISSION",
    separateApprovalRequired: true,
    productionApplyExecuted: false,
  };
}

function legacyHistory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "30878594429",
    requestId: "REQ-20260804-46393c12ed",
    taskId: "TASK-N2-003",
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "n2-task-executor-registry-v1",
    startedAt: "2026-08-04T04:45:32.951Z",
    completedAt: "2026-08-04T04:46:44.605Z",
    executed: true,
    result: "PASS",
    blocks: [],
    outputs: [OUTPUT_PATH],
    outputDigest: OUTPUT_DIGEST,
    summary: legacySummary(),
    authoritySha: "3d2d31d",
    elapsedMs: 71654,
    ...overrides,
  };
}

function legacyOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...legacySummary(),
    runId: "30878594429",
    requestId: "REQ-20260804-46393c12ed",
    taskId: "TASK-N2-003",
    executorVersion: "n2-task-executor-registry-v1",
    generatedAt: "2026-08-04T04:46:44.604Z",
    outputDigest: OUTPUT_DIGEST,
    ...overrides,
  };
}

test("known pre-intent legacy history is durable but never strong", () => {
  withRoot((root) => {
    writeJson(root, HISTORY_PATH, legacyHistory());
    writeJson(root, OUTPUT_PATH, legacyOutput());
    const report = buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility({
      repoRoot: root,
      generatedAt: "2026-08-07T07:30:00.000Z",
    });
    assert.equal(report.status, "DEGRADED");
    assert.equal(report.historyFileCount, 1);
    assert.equal(report.assessedRunCount, 1);
    assert.equal(report.invalidHistoryCount, 0);
    assert.equal(report.incompleteCount, 0);
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 0);
    assert.equal(report.passWithDurableOutputsCount, 1);
    assert.equal(report.currentOutputDigestMatchCount, 1);
    assert.equal(report.missingOutputReferenceCount, 0);
    assert.equal(report.invalidOutputReferenceCount, 0);
    assert.equal(countAttestedLegacyDurableRuns(report), 1);
    assert.deepEqual(report.runs[0]?.issues, []);
    assert.match(report.runs[0]?.warnings[0] ?? "", /LEGACY_HISTORY_V0_ATTESTED/u);
    assert.equal(report.runs[0]?.outputs[0]?.integrity, "CURRENT_OUTPUT_DIGEST_MATCH");
    assert.equal(report.runs[0]?.outputs[0]?.complete, true);
    assert.equal(report.currentBuyConnectionAuthorized, false);
    assert.equal(report.lineConnectionAuthorized, false);
    assert.equal(report.databaseWriteAuthorized, false);
    assert.equal(report.publicPublishAuthorized, false);
    assert.equal(report.automatedBettingAuthorized, false);
    assert.equal(report.productionApplyAuthorized, false);
  });
});

test("legacy output lineage mismatch remains blocked", () => {
  withRoot((root) => {
    writeJson(root, HISTORY_PATH, legacyHistory());
    writeJson(root, OUTPUT_PATH, legacyOutput({ heldOutCount: 99 }));
    const report = buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidHistoryCount, 1);
    assert.equal(report.durableCompleteCount, 0);
    assert.equal(countAttestedLegacyDurableRuns(report), 0);
    assert.deepEqual(
      [...(report.runs[0]?.issues ?? [])].sort(),
      ["HISTORY_AUTHORITY_SHA_INVALID", "HISTORY_IDEMPOTENCY_KEY_INVALID", "HISTORY_INTENT_ID_INVALID"].sort(),
    );
  });
});

test("near-miss short authority legacy history is not grandfathered", () => {
  withRoot((root) => {
    writeJson(root, HISTORY_PATH, legacyHistory({ authoritySha: "3d2d31e" }));
    writeJson(root, OUTPUT_PATH, legacyOutput());
    const report = buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidHistoryCount, 1);
    assert.equal(countAttestedLegacyDurableRuns(report), 0);
  });
});

test("adding modern intent fields to the legacy tuple is not accepted as legacy v0", () => {
  withRoot((root) => {
    writeJson(root, HISTORY_PATH, legacyHistory({
      intentId: "INTENT-forged",
      idempotencyKey: "0".repeat(64),
    }));
    writeJson(root, OUTPUT_PATH, legacyOutput());
    const report = buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(countAttestedLegacyDurableRuns(report), 0);
  });
});
