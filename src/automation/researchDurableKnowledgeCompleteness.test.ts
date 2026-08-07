import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { contractDigest } from "../research/governance/contracts";
import {
  buildResearchDurableKnowledgeCompletenessReport,
} from "./researchDurableKnowledgeCompleteness";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-durable-knowledge-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function history(input: {
  runId: string;
  taskId: string;
  result: "PASS" | "DRY_RUN_OK" | "CONDITIONAL" | "BLOCKED" | "FAILED";
  outputs?: string[];
  outputDigest?: string;
  blocks?: string[];
  summary?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    runId: input.runId,
    requestId: `REQ-${input.runId}`,
    intentId: `INTENT-${input.runId}`,
    taskId: input.taskId,
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "fixture-executor-v1",
    executed: true,
    result: input.result,
    blocks: input.blocks ?? [],
    outputs: input.outputs ?? [],
    outputDigest: input.outputDigest ?? "a".repeat(64),
    summary: input.summary ?? {},
    authoritySha: "b".repeat(40),
    idempotencyKey: "c".repeat(64),
    startedAt: "2026-08-07T01:00:00.000Z",
    completedAt: "2026-08-07T01:00:01.000Z",
    elapsedMs: 1000,
  };
}

function writeHistory(root: string, value: Record<string, unknown>): void {
  const runId = String(value.runId);
  const taskId = String(value.taskId);
  writeJson(root, `reports/automation/history/${runId}-${taskId}.json`, value);
}

test("PASS with current report digest is strong durable knowledge", () => {
  withRoot((root) => {
    const digest = "1".repeat(64);
    writeJson(root, "reports/n2/example.json", { reportVersion: "v1", outputDigest: digest });
    writeHistory(root, history({
      runId: "1001",
      taskId: "TASK-N2-001",
      result: "PASS",
      outputs: ["reports/n2/example.json"],
      outputDigest: digest,
      summary: { status: "PASS" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 1);
    assert.equal(report.currentOutputDigestMatchCount, 1);
    assert.equal(report.runs[0].classification, "PASS_DURABLE_OUTPUTS");
    assert.equal(report.runs[0].outputs[0].integrity, "CURRENT_OUTPUT_DIGEST_MATCH");
  });
});

test("PASS with a later mutable report remains durable but is degraded", () => {
  withRoot((root) => {
    writeJson(root, "reports/n2/example.json", { reportVersion: "v2", outputDigest: "2".repeat(64) });
    writeHistory(root, history({
      runId: "1002",
      taskId: "TASK-N2-002",
      result: "PASS",
      outputs: ["reports/n2/example.json"],
      outputDigest: "1".repeat(64),
      summary: { status: "PASS" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "DEGRADED");
    assert.equal(report.durableCompleteCount, 1);
    assert.equal(report.strongDurableCompleteCount, 0);
    assert.equal(report.mutableSupersededReferenceCount, 1);
    assert.equal(report.runs[0].classification, "PASS_DURABLE_OUTPUTS");
    assert.equal(report.runs[0].outputs[0].integrity, "CURRENT_OUTPUT_DIGEST_SUPERSEDED");
  });
});

test("append-only registry output requires a valid registry self digest", () => {
  withRoot((root) => {
    const body = {
      experimentId: "EXP-fixture",
      researchQuestion: "fixture question",
      rationale: "fixture rationale",
      hypothesis: "fixture hypothesis",
      dataSnapshot: "fixture-data",
      trialFamilyId: "TF-fixture",
      totalTrialCount: 1,
      testedConditions: 1,
      discoveryPeriod: "fixture",
      validationPeriod: "fixture",
      holdoutPolicy: "fixture",
      primaryMetric: "fixture",
      secondaryMetrics: [] as string[],
      minimumSample: 1,
      stoppingRule: "fixture",
      successCondition: "fixture",
      rejectionCondition: "fixture",
      multiplicityFamily: "fixture",
      evidenceStage: "exploration",
      status: "completed",
      createdAt: "2026-08-07T01:00:00.000Z",
    };
    writeJson(root, "research/registries/experiments/EXP-fixture.json", {
      ...body,
      _digest: contractDigest(body),
      _recordedAt: "2026-08-07T01:00:02.000Z",
    });
    writeHistory(root, history({
      runId: "1003",
      taskId: "TASK-N2-003",
      result: "PASS",
      outputs: ["research/registries/experiments/EXP-fixture.json"],
      outputDigest: "3".repeat(64),
      summary: { status: "PASS" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.registryOutputCount, 1);
    assert.equal(report.runs[0].outputs[0].integrity, "REGISTRY_SELF_DIGEST_VERIFIED");
  });
});

test("tampered registry output blocks completeness", () => {
  withRoot((root) => {
    writeJson(root, "research/registries/experiments/EXP-bad.json", {
      experimentId: "EXP-bad",
      _digest: "4".repeat(64),
      _recordedAt: "2026-08-07T01:00:02.000Z",
    });
    writeHistory(root, history({
      runId: "1004",
      taskId: "TASK-N2-004",
      result: "PASS",
      outputs: ["research/registries/experiments/EXP-bad.json"],
      outputDigest: "4".repeat(64),
      summary: { status: "PASS" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.invalidOutputReferenceCount, 1);
    assert.equal(report.runs[0].durableComplete, false);
    assert.match(report.runs[0].issues.join("\n"), /DURABLE_REGISTRY_SELF_DIGEST_INVALID/u);
  });
});

test("PASS no-change run is durable from immutable history alone", () => {
  withRoot((root) => {
    writeHistory(root, history({
      runId: "1005",
      taskId: "TASK-PLANNER-NEXT",
      result: "PASS",
      summary: { status: "NO_CHANGE_ENGINEERING_REQUIRED", noChangeEngineeringRequired: true },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.passNoChangeHistoryCount, 1);
    assert.equal(report.runs[0].classification, "PASS_NO_CHANGE_HISTORY");
    assert.equal(report.runs[0].durableComplete, true);
  });
});

test("PASS with no output and no no-change marker is incomplete", () => {
  withRoot((root) => {
    writeHistory(root, history({
      runId: "1006",
      taskId: "TASK-N2-006",
      result: "PASS",
      summary: { status: "PASS" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "DEGRADED");
    assert.equal(report.incompleteCount, 1);
    assert.equal(report.runs[0].classification, "INCOMPLETE_PASS_NO_OUTPUT");
    assert.match(report.runs[0].issues.join("\n"), /PASS_HAS_NO_DURABLE_OUTPUT/u);
  });
});

test("BLOCKED run with explicit blockers is durable negative evidence", () => {
  withRoot((root) => {
    writeHistory(root, history({
      runId: "1007",
      taskId: "TASK-N2-007",
      result: "BLOCKED",
      blocks: ["INPUT_CONTRACT", "ACTIVE_WAL"],
      summary: {},
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "PASS");
    assert.equal(report.nonPassDurableHistoryCount, 1);
    assert.equal(report.runs[0].classification, "NON_PASS_DURABLE_HISTORY");
    assert.equal(report.runs[0].durableComplete, true);
  });
});

test("persisted DRY_RUN_OK is a structural violation", () => {
  withRoot((root) => {
    writeHistory(root, history({
      runId: "1008",
      taskId: "TASK-N2-008",
      result: "DRY_RUN_OK",
      summary: { status: "DRY_RUN" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.persistedDryRunCount, 1);
    assert.equal(report.runs[0].classification, "INVALID_PERSISTED_DRY_RUN");
  });
});

test("missing referenced output degrades a PASS run", () => {
  withRoot((root) => {
    writeHistory(root, history({
      runId: "1009",
      taskId: "TASK-N2-009",
      result: "PASS",
      outputs: ["reports/n2/missing.json"],
      summary: { status: "PASS" },
    }));
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "DEGRADED");
    assert.equal(report.missingOutputReferenceCount, 1);
    assert.equal(report.runs[0].classification, "INCOMPLETE_OUTPUT_REFERENCE");
  });
});

test("missing history directory returns NO_HISTORY without writes", () => {
  withRoot((root) => {
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    assert.equal(report.status, "NO_HISTORY");
    assert.equal(report.historyFileCount, 0);
    assert.equal(report.assessedRunCount, 0);
    assert.equal(report.databaseWriteAuthorized, false);
    assert.equal(report.currentBuyConnectionAuthorized, false);
  });
});
