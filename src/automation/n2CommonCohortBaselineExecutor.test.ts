import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { enumerateBetSelections } from "../research-replay/n2DatasetContract";
import type { N2HistoricalOnlyBaselineSourceRead } from "../research-replay/n2HistoricalOnlyBaselineSource";
import type { N2MarketOnlyBaselinePrivateSourceRead } from "../research-replay/n2MarketOnlyBaselinePrivateSource";
import type { N2T5DecisionCutoffMetadataRead } from "../research-replay/n2T5DecisionCutoffMetadata";
import { createN2CommonCohortBaselineExecutor } from "./n2CommonCohortBaselineExecutor";
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

function marketRead(overrides: Partial<N2MarketOnlyBaselinePrivateSourceRead> = {}): N2MarketOnlyBaselinePrivateSourceRead {
  const races = evaluationRaces();
  return {
    readerVersion: "n2-market-only-baseline-private-source-v1",
    status: "PASS",
    blockers: [],
    readinessStatus: "READY_FOR_N2_020",
    readinessDigest: "a".repeat(64),
    acceptedT5RaceCount: 20,
    settledAcceptedT5RaceCount: 20,
    selectedCohortRaceCount: 20,
    sources: races.map((race, raceIndex) => ({
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
    ...overrides,
  };
}

function historicalRead(overrides: Partial<N2HistoricalOnlyBaselineSourceRead> = {}): N2HistoricalOnlyBaselineSourceRead {
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
    ...overrides,
  };
}

function cutoffRead(overrides: Partial<N2T5DecisionCutoffMetadataRead> = {}): N2T5DecisionCutoffMetadataRead {
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
    ...overrides,
  };
}

function context(root: string, taskStatuses: Record<string, string> = {
  "TASK-N2-020": "PASS",
  "TASK-N2-021": "PASS",
}): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-common-cohort-test",
    requestId: "REQ-common-cohort-test",
    taskId: "TASK-N2-022",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses,
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-common-cohort-executor-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("executor persists only aggregate three-baseline common cohort evidence", () => {
  withRoot((root) => {
    const executor = createN2CommonCohortBaselineExecutor(
      () => marketRead(),
      () => historicalRead(),
      () => cutoffRead(),
    );
    const result = executor(context(root));
    assert.equal(result.result, "PASS");
    assert.deepEqual(result.outputs, ["reports/n2/n2-baseline-common-cohort.json"]);
    const reportPath = join(root, "reports/n2/n2-baseline-common-cohort.json");
    assert.equal(existsSync(reportPath), true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    assert.equal(report.status, "COMPARABLE");
    assert.equal(report.requiredBaselineCount, 3);
    assert.equal(report.requiredCommonRowCount, 2400);
    assert.equal(report.commonRowCount, 2400);
    assert.equal(report.commonPositiveCount, 20);
    const baselineIds = report.baselineIds as string[];
    const baselineKinds = report.baselineKinds as string[];
    assert.deepEqual(
      baselineIds.map((baselineId, index) => [baselineId, baselineKinds[index]]),
      [
        ["n2-historical-venue-frequency-v1", "historical_only"],
        ["n2-legacy-boatpon-v3-core-v1", "legacy"],
        ["n2-market-only-t5-v1", "market_only"],
      ],
    );
    assert.equal(report.currentBuyConnectionAuthorized, false);
    assert.equal(report.lineConnectionAuthorized, false);
    assert.equal(report.publicPublishAuthorized, false);
    assert.equal(report.automatedBettingAuthorized, false);
    assert.equal(report.productionApplyExecuted, false);
    const persisted = JSON.stringify(report);
    assert.doesNotMatch(persisted, /"rows"\s*:/u);
    assert.doesNotMatch(persisted, /"sources"\s*:/u);
    assert.doesNotMatch(persisted, /"winningSelection"\s*:/u);
    assert.doesNotMatch(persisted, /"decisionCutoffByRaceKey"\s*:/u);
    assert.doesNotMatch(persisted, /2026-08-07:05:R/u);
    assert.match(String(report.outputDigest), /^[0-9a-f]{64}$/u);
  });
});

test("executor checks N2-020 and N2-021 dependencies before reading private evidence", () => {
  withRoot((root) => {
    let marketCalls = 0;
    let historicalCalls = 0;
    let cutoffCalls = 0;
    const executor = createN2CommonCohortBaselineExecutor(
      () => { marketCalls += 1; return marketRead(); },
      () => { historicalCalls += 1; return historicalRead(); },
      () => { cutoffCalls += 1; return cutoffRead(); },
    );
    const result = executor(context(root, {
      "TASK-N2-020": "PASS",
      "TASK-N2-021": "BLOCKED",
    }));
    assert.equal(result.result, "BLOCKED");
    assert.equal(marketCalls, 0);
    assert.equal(historicalCalls, 0);
    assert.equal(cutoffCalls, 0);
    assert.ok(result.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-021")));
  });
});

test("executor fails closed if market readiness regresses", () => {
  withRoot((root) => {
    const executor = createN2CommonCohortBaselineExecutor(
      () => marketRead({ status: "BLOCKED", blockers: ["READINESS_ACCUMULATING"], sources: [] }),
      () => historicalRead(),
      () => cutoffRead(),
    );
    const result = executor(context(root));
    assert.equal(result.result, "BLOCKED");
    assert.ok(result.blocks.some((blocker) => blocker.includes("COMMON_COHORT_MARKET_READINESS_ACCUMULATING")));
    assert.deepEqual(result.outputs, []);
  });
});

test("executor fails closed if cutoff metadata regresses", () => {
  withRoot((root) => {
    const executor = createN2CommonCohortBaselineExecutor(
      () => marketRead(),
      () => historicalRead(),
      () => cutoffRead({ status: "BLOCKED", blockers: ["CUTOFF_MISSING"], decisionCutoffByRaceKey: {} }),
    );
    const result = executor(context(root));
    assert.equal(result.result, "BLOCKED");
    assert.ok(result.blocks.some((blocker) => blocker.includes("COMMON_COHORT_CUTOFF_CUTOFF_MISSING")));
    assert.deepEqual(result.outputs, []);
  });
});
