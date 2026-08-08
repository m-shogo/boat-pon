import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { enumerateBetSelections } from "../research-replay/n2DatasetContract";
import type { N2EvaluationMetricsSettlementRead } from "../research-replay/n2EvaluationMetricsSettlementReader";
import type { N2HistoricalOnlyBaselineSourceRead } from "../research-replay/n2HistoricalOnlyBaselineSource";
import type { N2MarketOnlyBaselinePrivateSourceRead } from "../research-replay/n2MarketOnlyBaselinePrivateSource";
import type { N2T5DecisionCutoffMetadataRead } from "../research-replay/n2T5DecisionCutoffMetadata";
import { createN2EvaluationMetricsExecutor } from "./n2EvaluationMetricsExecutor";
import type { ExecutorContext } from "./taskExecutors";

const selections = enumerateBetSelections("trifecta");

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function evaluationRaces() {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      canonicalRaceKey: `2026-08-07:05:R${index + 1}`,
      winningSelection: selections[index],
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      canonicalRaceKey: `2026-08-08:05:R${index + 1}`,
      winningSelection: selections[index + 12],
    })),
  ];
}

function cutoffs(): Record<string, string> {
  return Object.fromEntries(evaluationRaces().map((race) => [
    race.canonicalRaceKey,
    `${race.canonicalRaceKey.slice(0, 10)}T03:30:00.000Z`,
  ]));
}

function marketRead(): N2MarketOnlyBaselinePrivateSourceRead {
  return {
    readerVersion: "n2-market-only-baseline-private-source-v1",
    status: "PASS",
    blockers: [],
    readinessStatus: "READY_FOR_N2_020",
    readinessDigest: "a".repeat(64),
    acceptedT5RaceCount: 20,
    settledAcceptedT5RaceCount: 20,
    selectedCohortRaceCount: 20,
    sources: evaluationRaces().map((race, raceIndex) => ({
      canonicalRaceKey: race.canonicalRaceKey,
      decisionCutoff: cutoffs()[race.canonicalRaceKey],
      capturedAt: `${race.canonicalRaceKey.slice(0, 10)}T03:25:30.000Z`,
      availableAt: `${race.canonicalRaceKey.slice(0, 10)}T03:25:00.000Z`,
      observationId: `obs-${raceIndex}`,
      rawDocumentId: `raw-${raceIndex}`,
      winningSelection: race.winningSelection,
      selections: selections.map((selection, selectionIndex) => ({
        selection,
        odds: 2 + selectionIndex + raceIndex / 100,
      })),
    })),
    privateRawFileReadCount: 20,
    privateEnvelopeReadCount: 20,
    databaseReadCount: 2,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}

function historicalRead(): N2HistoricalOnlyBaselineSourceRead {
  const training = Array.from({ length: 175 }, (_, index) => ({
    canonicalRaceKey: `${isoDate("2026-08-07", index - 175)}:05:R1`,
    winningSelection: selections[index % 19],
  }));
  return {
    readerVersion: "n2-historical-only-baseline-source-v1",
    status: "PASS",
    blockers: [],
    readinessStatus: "READY_FOR_N2_020",
    readinessDigest: "b".repeat(64),
    acceptedT5RaceCount: 20,
    settledAcceptedT5RaceCount: 20,
    selectedCohortRaceCount: 20,
    historicalTrainingRaceCount: training.length,
    trainingFromDateInclusive: "2026-02-08",
    trainingToDateInclusive: "2026-08-08",
    training,
    evaluationRaces: evaluationRaces(),
    databaseReadCount: 2,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawOddsValuesRead: false,
    liveOnlyFeatureReadCount: 0,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}

function cutoffRead(): N2T5DecisionCutoffMetadataRead {
  return {
    readerVersion: "n2-t5-decision-cutoff-metadata-v1",
    status: "PASS",
    blockers: [],
    decisionCutoffByRaceKey: cutoffs(),
    privateEnvelopeMetadataReadCount: 20,
    rawOddsValuesRead: false,
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}

function settlementRead(overrides: Partial<N2EvaluationMetricsSettlementRead> = {}): N2EvaluationMetricsSettlementRead {
  const settlements = evaluationRaces().map((race, index) => ({
    canonicalRaceKey: race.canonicalRaceKey,
    winningSelection: race.winningSelection,
    payoutYen: 800 + index * 10,
  }));
  return {
    readerVersion: "n2-evaluation-metrics-settlement-reader-v1",
    status: "PASS",
    blockers: [],
    requestedRaceCount: 20,
    settlementCount: 20,
    settlements,
    databaseReadCount: 1,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    sourcePolicy: "canonical_active_clean_normal_trifecta_payout",
    outputDigest: "c".repeat(64),
    ...overrides,
  };
}

function context(root: string, taskStatuses: Record<string, string> = { "TASK-N2-022": "PASS" }): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-metrics-test",
    requestId: "REQ-metrics-test",
    taskId: "TASK-N2-030",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses,
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-evaluation-metrics-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("executor persists only aggregate predictive/economic metrics on the exact common cohort", () => {
  withRoot((root) => {
    const executor = createN2EvaluationMetricsExecutor(
      () => marketRead(),
      () => historicalRead(),
      () => cutoffRead(),
      () => settlementRead(),
    );
    const result = executor(context(root));
    assert.equal(result.result, "PASS");
    assert.deepEqual(result.outputs, ["reports/n2/n2-evaluation-metrics.json"]);
    const path = join(root, "reports/n2/n2-evaluation-metrics.json");
    assert.equal(existsSync(path), true);
    const report = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(report.status, "PASS");
    const common = report.commonCohort as Record<string, unknown>;
    assert.equal(common.commonRowCount, 2400);
    assert.equal(common.commonPositiveCount, 20);
    const economic = report.economic as Record<string, unknown>;
    assert.equal(economic.status, "PASS");
    assert.equal(economic.raceCount, 20);
    assert.equal(economic.baselineCount, 3);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /"rows"\s*:/u);
    assert.doesNotMatch(serialized, /"winningSelection"\s*:/u);
    assert.doesNotMatch(serialized, /"marketOddsBySelection"\s*:/u);
    assert.doesNotMatch(serialized, /2026-08-0[78]:05:R/u);
    assert.match(String(report.outputDigest), /^[0-9a-f]{64}$/u);
  });
});

test("executor checks N2-022 dependency before reading any private or settlement source", () => {
  withRoot((root) => {
    let calls = 0;
    const executor = createN2EvaluationMetricsExecutor(
      () => { calls += 1; return marketRead(); },
      () => { calls += 1; return historicalRead(); },
      () => { calls += 1; return cutoffRead(); },
      () => { calls += 1; return settlementRead(); },
    );
    const result = executor(context(root, { "TASK-N2-022": "BLOCKED" }));
    assert.equal(result.result, "BLOCKED");
    assert.equal(calls, 0);
    assert.ok(result.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-022")));
    assert.deepEqual(result.outputs, []);
  });
});

test("settlement regression blocks before an artifact is written", () => {
  withRoot((root) => {
    const executor = createN2EvaluationMetricsExecutor(
      () => marketRead(),
      () => historicalRead(),
      () => cutoffRead(),
      () => settlementRead({ status: "BLOCKED", blockers: ["SETTLEMENT_COUNT:19/20"], settlements: [], settlementCount: 0 }),
    );
    const result = executor(context(root));
    assert.equal(result.result, "BLOCKED");
    assert.ok(result.blocks.some((blocker) => blocker.includes("METRICS_SETTLEMENT_SETTLEMENT_COUNT:19/20")));
    assert.equal(existsSync(join(root, "reports/n2/n2-evaluation-metrics.json")), false);
  });
});
