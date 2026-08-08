import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import { buildN2EvaluationMetricsBundle } from "./n2EvaluationMetricsBundle";

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

function marketSources() {
  return evaluationRaces().map((race, raceIndex) => ({
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
  }));
}

function training() {
  return Array.from({ length: 175 }, (_, index) => ({
    canonicalRaceKey: `${isoDate("2026-08-07", index - 175)}:05:R1`,
    winningSelection: selections[index % 19],
  }));
}

function settlements() {
  return evaluationRaces().map((race, index) => ({
    canonicalRaceKey: race.canonicalRaceKey,
    winningSelection: race.winningSelection,
    payoutYen: 800 + index * 10,
  }));
}

test("metrics bundle recomputes exact three-baseline common cohort and aggregate economics", () => {
  const report = buildN2EvaluationMetricsBundle({
    marketSources: marketSources(),
    historicalTraining: training(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
    settlements: settlements(),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.commonCohort.status, "COMPARABLE");
  assert.equal(report.commonCohort.baselineIds.length, 3);
  assert.equal(report.commonCohort.commonRowCount, 2400);
  assert.equal(report.commonCohort.commonPositiveCount, 20);
  assert.equal(Object.keys(report.predictiveByBaseline).length, 3);
  assert.equal(report.economic.status, "PASS");
  assert.equal(report.economic.raceCount, 20);
  assert.equal(report.economic.baselineCount, 3);
  assert.match(report.datasetDigests.market, /^[0-9a-f]{64}$/u);
  assert.match(report.datasetDigests.historical, /^[0-9a-f]{64}$/u);
  assert.match(report.datasetDigests.legacy, /^[0-9a-f]{64}$/u);
  assert.match(report.settlementSetDigest, /^[0-9a-f]{64}$/u);
  assert.equal(report.privacy.rowLevelPredictionsPersisted, false);
  assert.equal(report.privacy.rawMarketOddsPersisted, false);
  assert.equal(report.privacy.winningSelectionsPersisted, false);
  assert.equal(report.privacy.payoutsByRacePersisted, false);
  assert.equal(report.privacy.raceKeysPersisted, false);
  assert.equal(report.authority.currentBuyConnectionAuthorized, false);
  assert.equal(report.authority.automatedBettingAuthorized, false);
  const persistedShape = JSON.stringify(report);
  assert.doesNotMatch(persistedShape, /"rows"\s*:/u);
  assert.doesNotMatch(persistedShape, /"winningSelection"\s*:/u);
  assert.doesNotMatch(persistedShape, /"marketOddsBySelection"\s*:/u);
  assert.doesNotMatch(persistedShape, /2026-08-0[78]:05:R/u);
});

test("settlement label conflict fails closed before economic scoring", () => {
  const badSettlements = settlements();
  badSettlements[0] = { ...badSettlements[0], winningSelection: selections[119] };
  const report = buildN2EvaluationMetricsBundle({
    marketSources: marketSources(),
    historicalTraining: training(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
    settlements: badSettlements,
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.includes("WINNING_SELECTION_CONFLICT")));
});

test("missing settlement fails closed rather than evaluating a smaller cohort", () => {
  const report = buildN2EvaluationMetricsBundle({
    marketSources: marketSources(),
    historicalTraining: training(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
    settlements: settlements().slice(0, 19),
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.includes("SETTLEMENT_MISSING")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("SETTLEMENT_COUNT:19/20")));
});

test("metrics bundle is deterministic for identical inputs", () => {
  const input = {
    marketSources: marketSources(),
    historicalTraining: training(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
    settlements: settlements(),
  };
  const first = buildN2EvaluationMetricsBundle(input);
  const second = buildN2EvaluationMetricsBundle(input);
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.predictiveByBaseline, second.predictiveByBaseline);
  assert.deepEqual(first.economic, second.economic);
});
