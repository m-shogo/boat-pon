import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { enumerateBetSelections } from "../research-replay/n2DatasetContract";
import type { N2HistoricalOnlyBaselineSourceRead } from "../research-replay/n2HistoricalOnlyBaselineSource";
import { createN2HistoricalOnlyBaselineExecutor } from "./n2HistoricalOnlyBaselineExecutor";
import type { ExecutorContext } from "./taskExecutors";

const selections = enumerateBetSelections("trifecta");

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function sourceRead(overrides: Partial<N2HistoricalOnlyBaselineSourceRead> = {}): N2HistoricalOnlyBaselineSourceRead {
  const training = Array.from({ length: 175 }, (_, index) => {
    const date = isoDate("2026-08-07", index - 175);
    return {
      canonicalRaceKey: `${date}:05:R1`,
      winningSelection: selections[index % selections.length],
    };
  });
  const evaluationRaces = [
    ...Array.from({ length: 12 }, (_, index) => ({
      canonicalRaceKey: `2026-08-07:05:R${index + 1}`,
      winningSelection: selections[index],
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      canonicalRaceKey: `2026-08-08:05:R${index + 1}`,
      winningSelection: selections[index + 12],
    })),
  ];
  return {
    readerVersion: "n2-historical-only-baseline-source-v1",
    status: "PASS",
    blockers: [],
    readinessStatus: "READY_FOR_N2_020",
    readinessDigest: "a".repeat(64),
    acceptedT5RaceCount: 20,
    settledAcceptedT5RaceCount: 20,
    selectedCohortRaceCount: 20,
    historicalTrainingRaceCount: training.length,
    trainingFromDateInclusive: "2026-02-08",
    trainingToDateInclusive: "2026-08-08",
    training,
    evaluationRaces,
    databaseReadCount: 2,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawOddsValuesRead: false,
    liveOnlyFeatureReadCount: 0,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
    ...overrides,
  };
}

function context(root: string, taskStatuses: Record<string, string> = {
  "TASK-N2-005": "PASS",
  "TASK-N2-011": "PASS",
}): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-historical-baseline-test",
    requestId: "REQ-historical-baseline-test",
    taskId: "TASK-N2-021",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses,
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-historical-baseline-executor-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("executor writes aggregate historical baseline metrics without row-level labels", () => {
  withRoot((root) => {
    let readerCalls = 0;
    const executor = createN2HistoricalOnlyBaselineExecutor(() => {
      readerCalls += 1;
      return sourceRead();
    });
    const result = executor(context(root));
    assert.equal(result.result, "PASS");
    assert.equal(readerCalls, 1);
    assert.deepEqual(result.outputs, ["reports/n2/n2-baseline-historical.json"]);
    const reportPath = join(root, "reports/n2/n2-baseline-historical.json");
    assert.equal(existsSync(reportPath), true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    assert.equal(report.baselineId, "n2-historical-venue-frequency-v1");
    assert.equal(report.cohortRaceCount, 20);
    assert.equal(report.predictionRowCount, 2400);
    assert.equal(report.positiveCount, 20);
    assert.equal(report.currentBuyConnectionAuthorized, false);
    assert.equal(report.lineConnectionAuthorized, false);
    assert.equal(report.publicPublishAuthorized, false);
    assert.equal(report.automatedBettingAuthorized, false);
    assert.equal(report.productionApplyExecuted, false);
    const persisted = JSON.stringify(report);
    assert.doesNotMatch(persisted, /"rows"\s*:/u);
    assert.doesNotMatch(persisted, /"training"\s*:/u);
    assert.doesNotMatch(persisted, /"evaluationRaces"\s*:/u);
    assert.doesNotMatch(persisted, /"winningSelection"\s*:/u);
    assert.doesNotMatch(persisted, /2026-08-07:05:R/u);
    assert.match(String(report.outputDigest), /^[0-9a-f]{64}$/u);
  });
});

test("executor blocks on dependencies before reading historical state", () => {
  withRoot((root) => {
    let readerCalls = 0;
    const executor = createN2HistoricalOnlyBaselineExecutor(() => {
      readerCalls += 1;
      return sourceRead();
    });
    const result = executor(context(root, {
      "TASK-N2-005": "BLOCKED",
      "TASK-N2-011": "PASS",
    }));
    assert.equal(result.result, "BLOCKED");
    assert.equal(readerCalls, 0);
    assert.ok(result.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-005")));
    assert.deepEqual(result.outputs, []);
  });
});

test("executor remains blocked when shared cohort readiness is not satisfied", () => {
  withRoot((root) => {
    const executor = createN2HistoricalOnlyBaselineExecutor(() => sourceRead({
      status: "BLOCKED",
      blockers: ["READINESS_ACCUMULATING"],
      readinessStatus: "ACCUMULATING",
      settledAcceptedT5RaceCount: 19,
      selectedCohortRaceCount: 0,
      historicalTrainingRaceCount: 0,
      training: [],
      evaluationRaces: [],
      databaseReadCount: 1,
    }));
    const result = executor(context(root));
    assert.equal(result.result, "BLOCKED");
    assert.ok(result.blocks.some((blocker) => blocker.includes("HISTORICAL_BASELINE_READINESS_ACCUMULATING")));
    assert.deepEqual(result.outputs, []);
  });
});
