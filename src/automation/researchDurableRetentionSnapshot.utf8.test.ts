import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import type { ResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableRetentionSnapshot,
  persistResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

function report(): ResearchDurableKnowledgeCompletenessReport {
  return {
    reportVersion: "research-durable-knowledge-completeness-v1",
    evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY",
    generatedAt: "2026-08-07T07:00:00.000Z",
    historyRelativeDir: "reports/automation/history",
    status: "DEGRADED",
    historyFileCount: 1,
    assessedRunCount: 1,
    passCount: 1,
    conditionalCount: 0,
    blockedCount: 0,
    failedCount: 0,
    persistedDryRunCount: 0,
    durableCompleteCount: 1,
    strongDurableCompleteCount: 0,
    incompleteCount: 0,
    invalidHistoryCount: 0,
    passWithDurableOutputsCount: 1,
    passNoChangeHistoryCount: 0,
    nonPassDurableHistoryCount: 0,
    missingOutputReferenceCount: 0,
    invalidOutputReferenceCount: 0,
    mutableSupersededReferenceCount: 0,
    registryOutputCount: 0,
    currentOutputDigestMatchCount: 1,
    earliestCompletedAt: "2026-08-04T04:46:44.605Z",
    latestCompletedAt: "2026-08-04T04:46:44.605Z",
    taskTypeCounts: { "readonly-audit": 1 },
    classificationCounts: {
      PASS_DURABLE_OUTPUTS: 1,
      PASS_NO_CHANGE_HISTORY: 0,
      NON_PASS_DURABLE_HISTORY: 0,
      INCOMPLETE_PASS_NO_OUTPUT: 0,
      INVALID_PERSISTED_DRY_RUN: 0,
      INVALID_HISTORY: 0,
      INCOMPLETE_OUTPUT_REFERENCE: 0,
    },
    runs: [{
      historyRelativePath: "reports/automation/history/1-TASK-N2-003.json",
      historyContentDigest: "b".repeat(64),
      runId: "1",
      requestId: "REQ-1",
      intentId: null,
      taskId: "TASK-N2-003",
      taskType: "readonly-audit",
      result: "PASS",
      executed: true,
      startedAt: "2026-08-04T04:45:32.951Z",
      completedAt: "2026-08-04T04:46:44.605Z",
      outputDigest: "c".repeat(64),
      outputCount: 1,
      verifiedOutputCount: 1,
      mutableSupersededReferenceCount: 0,
      registryOutputCount: 0,
      explicitNoChange: false,
      classification: "PASS_DURABLE_OUTPUTS",
      durableComplete: true,
      strongDurableComplete: false,
      issues: [],
      warnings: ["LEGACY_HISTORY_V0_ATTESTED_NO_INTENT_IDEMPOTENCY_FULL_SHA"],
      outputs: [{
        relativePath: "reports/n2/example.json",
        rootClass: "REPORT",
        integrity: "CURRENT_OUTPUT_DIGEST_MATCH",
        exists: true,
        regularFile: true,
        bytes: 100,
        contentDigest: "d".repeat(64),
        embeddedDigest: "c".repeat(64),
        historyDigestMatchesEmbedded: true,
        complete: true,
        issues: [],
        warnings: [],
      }],
    }],
    automaticPromotionAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    databaseWriteAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
    outputDigest: "e".repeat(64),
  };
}

test("existing retention snapshots with invalid UTF-8 are rejected before JSON parsing", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-utf8-"));
  try {
    const snapshot = buildResearchDurableRetentionSnapshot({
      report: report(),
      sourceStateSha: "1".repeat(40),
      mainAuthoritySha: "a".repeat(40),
      firstObservedAt: "2026-08-07T07:40:00.000Z",
    });
    const first = persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot });
    assert.equal(first.changed, true);

    const absolutePath = join(root, first.relativePath);
    const validBytes = readFileSync(absolutePath);
    writeFileSync(absolutePath, Buffer.concat([validBytes.subarray(0, validBytes.length - 1), Buffer.from([0xff])]));

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_EXISTING_SNAPSHOT_UTF8_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
