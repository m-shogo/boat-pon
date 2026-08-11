import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import type { ResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableRetentionSnapshot,
  computeResearchDurableRetentionEvidenceDigest,
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  validateResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

const SOURCE_SHA = "1".repeat(40);
const NEXT_SOURCE_SHA = "2".repeat(40);
const MAIN_SHA = "a".repeat(40);

function report(overrides: Partial<ResearchDurableKnowledgeCompletenessReport> = {}): ResearchDurableKnowledgeCompletenessReport {
  const core = {
    reportVersion: "research-durable-knowledge-completeness-v1" as const,
    evidenceRole: "RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY" as const,
    generatedAt: "2026-08-07T07:00:00.000Z",
    historyRelativeDir: "reports/automation/history" as const,
    status: "DEGRADED" as const,
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
    runs: [
      {
        historyRelativePath: "reports/automation/history/1-TASK-N2-003.json",
        historyContentDigest: "b".repeat(64),
        runId: "1",
        requestId: "REQ-1",
        intentId: null,
        taskId: "TASK-N2-003",
        taskType: "readonly-audit",
        result: "PASS" as const,
        executed: true,
        startedAt: "2026-08-04T04:45:32.951Z",
        completedAt: "2026-08-04T04:46:44.605Z",
        outputDigest: "c".repeat(64),
        outputCount: 1,
        verifiedOutputCount: 1,
        mutableSupersededReferenceCount: 0,
        registryOutputCount: 0,
        explicitNoChange: false,
        classification: "PASS_DURABLE_OUTPUTS" as const,
        durableComplete: true,
        strongDurableComplete: false,
        issues: [],
        warnings: ["LEGACY_HISTORY_V0_ATTESTED_NO_INTENT_IDEMPOTENCY_FULL_SHA"],
        outputs: [
          {
            relativePath: "reports/n2/example.json",
            rootClass: "REPORT" as const,
            integrity: "CURRENT_OUTPUT_DIGEST_MATCH" as const,
            exists: true,
            regularFile: true,
            bytes: 100,
            contentDigest: "d".repeat(64),
            embeddedDigest: "c".repeat(64),
            historyDigestMatchesEmbedded: true,
            complete: true,
            issues: [],
            warnings: [],
          },
        ],
      },
    ],
    automaticPromotionAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
    outputDigest: "e".repeat(64),
  };
  return { ...core, ...overrides } as ResearchDurableKnowledgeCompletenessReport;
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-snapshot-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("semantic evidence digest ignores audit timestamp and top-level audit digest churn", () => {
  const first = report();
  const second = report({
    generatedAt: "2026-08-07T08:00:00.000Z",
    outputDigest: "f".repeat(64),
  });
  assert.equal(
    computeResearchDurableRetentionEvidenceDigest(first),
    computeResearchDurableRetentionEvidenceDigest(second),
  );
});

test("semantic evidence digest changes when referenced evidence changes", () => {
  const first = report();
  const changedRun = {
    ...first.runs[0]!,
    historyContentDigest: "9".repeat(64),
  };
  const second = report({ runs: [changedRun] });
  assert.notEqual(
    computeResearchDurableRetentionEvidenceDigest(first),
    computeResearchDurableRetentionEvidenceDigest(second),
  );
});

test("snapshot path is JST-day plus semantic evidence digest", () => {
  const snapshot = buildResearchDurableRetentionSnapshot({
    report: report(),
    sourceStateSha: SOURCE_SHA,
    mainAuthoritySha: MAIN_SHA,
    firstObservedAt: "2026-08-07T15:30:00.000Z",
  });
  assert.equal(snapshot.effectiveDateJst, "2026-08-08");
  assert.equal(
    durableRetentionSnapshotRelativePath(snapshot),
    `reports/automation/retention/durable-knowledge/2026-08-08/${snapshot.evidenceDigest}.json`,
  );
  assert.equal(snapshot.legacyCompatibilityCount, 1);
  assert.equal(snapshot.nonStrongRuns.length, 1);
  assert.equal(snapshot.currentBuyConnectionAuthorized, false);
  assert.equal(snapshot.databaseWriteAuthorized, false);
  validateResearchDurableRetentionSnapshot(snapshot);
});

test("same semantic evidence is append-only idempotent even when state SHA advances", () => {
  withRoot((root) => {
    const first = buildResearchDurableRetentionSnapshot({
      report: report(),
      sourceStateSha: SOURCE_SHA,
      mainAuthoritySha: MAIN_SHA,
      firstObservedAt: "2026-08-07T07:40:00.000Z",
    });
    const firstWrite = persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot: first });
    assert.equal(firstWrite.changed, true);

    const repeated = buildResearchDurableRetentionSnapshot({
      report: report({ generatedAt: "2026-08-07T08:40:00.000Z", outputDigest: "0".repeat(64) }),
      sourceStateSha: NEXT_SOURCE_SHA,
      mainAuthoritySha: MAIN_SHA,
      firstObservedAt: "2026-08-07T08:40:00.000Z",
    });
    assert.equal(repeated.evidenceDigest, first.evidenceDigest);
    const secondWrite = persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot: repeated });
    assert.equal(secondWrite.changed, false);
    assert.equal(secondWrite.relativePath, firstWrite.relativePath);
    assert.equal(secondWrite.snapshot.sourceStateShaAtFirstObservation, SOURCE_SHA);
    assert.equal(secondWrite.snapshot.firstObservedAt, first.firstObservedAt);
  });
});

test("existing snapshot must match its canonical retention path", () => {
  withRoot((root) => {
    const expected = buildResearchDurableRetentionSnapshot({
      report: report(),
      sourceStateSha: SOURCE_SHA,
      mainAuthoritySha: MAIN_SHA,
      firstObservedAt: "2026-08-08T07:40:00.000Z",
    });
    const misplaced = buildResearchDurableRetentionSnapshot({
      report: report(),
      sourceStateSha: SOURCE_SHA,
      mainAuthoritySha: MAIN_SHA,
      firstObservedAt: "2026-08-07T07:40:00.000Z",
    });
    assert.equal(misplaced.evidenceDigest, expected.evidenceDigest);
    assert.notEqual(misplaced.effectiveDateJst, expected.effectiveDateJst);
    const expectedPath = join(root, durableRetentionSnapshotRelativePath(expected));
    mkdirSync(join(expectedPath, ".."), { recursive: true });
    writeFileSync(expectedPath, `${JSON.stringify(misplaced, null, 2)}\n`, "utf8");

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot: expected }),
      /DURABLE_RETENTION_EXISTING_SNAPSHOT_PATH_MISMATCH/u,
    );
  });
});

test("tampered existing snapshot fails closed instead of overwriting", () => {
  withRoot((root) => {
    const snapshot = buildResearchDurableRetentionSnapshot({
      report: report(),
      sourceStateSha: SOURCE_SHA,
      mainAuthoritySha: MAIN_SHA,
      firstObservedAt: "2026-08-07T07:40:00.000Z",
    });
    const written = persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot });
    const absolute = join(root, written.relativePath);
    const parsed = JSON.parse(readFileSync(absolute, "utf8")) as Record<string, unknown>;
    parsed.durableCompleteCount = 999;
    writeFileSync(absolute, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_SNAPSHOT_SELF_DIGEST_INVALID/u,
    );
  });
});

test("parent symlink is rejected before retention snapshot write", () => {
  withRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), "boat-pon-retention-outside-"));
    try {
      mkdirSync(join(root, "reports/automation"), { recursive: true });
      symlinkSync(outside, join(root, "reports/automation/retention"));
      const snapshot = buildResearchDurableRetentionSnapshot({
        report: report(),
        sourceStateSha: SOURCE_SHA,
        mainAuthoritySha: MAIN_SHA,
        firstObservedAt: "2026-08-07T07:40:00.000Z",
      });
      assert.throws(
        () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
        /DURABLE_RETENTION_PARENT_PATH_INVALID/u,
      );
      assert.deepEqual(readdirSync(outside), []);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("protected authority cannot be persisted", () => {
  assert.throws(
    () => buildResearchDurableRetentionSnapshot({
      report: report({ currentBuyConnectionAuthorized: true as never }),
      sourceStateSha: SOURCE_SHA,
      mainAuthoritySha: MAIN_SHA,
      firstObservedAt: "2026-08-07T07:40:00.000Z",
    }),
    /DURABLE_RETENTION_PROTECTED_AUTHORITY_NOT_FALSE/u,
  );
});