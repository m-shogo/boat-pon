import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import {
  N2_COMMON_COHORT_EVALUATION_VERSION,
  N2_COMMON_COHORT_REQUIRED_ROWS,
  evaluateN2CommonCohort,
} from "./n2CommonCohortEvaluation";
import type {
  N2HistoricalEvaluationRace,
  N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";
import type { N2MarketOnlyBaselineRaceSource } from "./n2MarketOnlyBaselineDataset";

const selections = enumerateBetSelections("trifecta");

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function historicalTraining(): N2HistoricalOutcomeRow[] {
  return Array.from({ length: 175 }, (_, index) => ({
    canonicalRaceKey: `${isoDate("2026-08-07", index - 175)}:05:R1`,
    winningSelection: selections[index % 19],
  }));
}

function evaluationRaces(): N2HistoricalEvaluationRace[] {
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

function marketSources(): N2MarketOnlyBaselineRaceSource[] {
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

test("N2 common cohort compares market, historical, and legacy on exactly 2400 rows", () => {
  const report = evaluateN2CommonCohort({
    marketSources: marketSources(),
    historicalTraining: historicalTraining(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  });
  assert.equal(report.evaluationVersion, N2_COMMON_COHORT_EVALUATION_VERSION);
  assert.equal(report.status, "COMPARABLE");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.requiredBaselineCount, 3);
  assert.equal(report.requiredCommonRowCount, N2_COMMON_COHORT_REQUIRED_ROWS);
  assert.equal(report.commonRowCount, 2400);
  assert.equal(report.commonPositiveCount, 20);
  assert.deepEqual(
    report.baselineIds.map((baselineId, index) => [baselineId, report.baselineKinds[index]]),
    [
      ["n2-historical-venue-frequency-v1", "historical_only"],
      ["n2-legacy-boatpon-v3-core-v1", "legacy"],
      ["n2-market-only-t5-v1", "market_only"],
    ],
  );
  assert.ok(Object.values(report.baselineInputRowCounts).every((count) => count === 2400));
  assert.ok(Object.values(report.excludedOutsideCommonCohort).every((count) => count === 0));
  assert.equal(Object.keys(report.baselineMetrics).length, 3);
  assert.match(report.commonCohortDigest, /^[0-9a-f]{64}$/u);
  assert.match(report.comparisonDigest, /^[0-9a-f]{64}$/u);
  assert.match(report.outputDigest, /^[0-9a-f]{64}$/u);
});

test("common cohort compares the same race membership even when actual cutoff order differs from race-key order", () => {
  const decisionCutoffByRaceKey = cutoffs();
  decisionCutoffByRaceKey["2026-08-07:05:R1"] = "2026-08-07T03:31:00.000Z";
  decisionCutoffByRaceKey["2026-08-07:05:R2"] = "2026-08-07T03:29:00.000Z";
  const market = marketSources().map((source) => ({
    ...source,
    decisionCutoff: decisionCutoffByRaceKey[source.canonicalRaceKey],
  }));

  const report = evaluateN2CommonCohort({
    marketSources: market,
    historicalTraining: historicalTraining(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey,
  });

  assert.equal(report.status, "COMPARABLE");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.commonRowCount, N2_COMMON_COHORT_REQUIRED_ROWS);
  assert.equal(report.commonPositiveCount, 20);
});

test("common cohort fails closed when one market cutoff diverges", () => {
  const market = marketSources();
  market[0] = {
    ...market[0],
    decisionCutoff: "2026-08-07T03:31:00.000Z",
  };
  const report = evaluateN2CommonCohort({
    marketSources: market,
    historicalTraining: historicalTraining(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("COMPARISON_STATUS:CONFLICT")
    || blocker.startsWith("CONFLICT:")));
  assert.equal(report.commonRowCount, 0);
});

test("common cohort fails closed if legacy training cannot satisfy its minimum", () => {
  const report = evaluateN2CommonCohort({
    marketSources: marketSources(),
    historicalTraining: historicalTraining().slice(0, 29),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.startsWith("HISTORICAL:") || blocker.startsWith("LEGACY:")));
  assert.equal(report.commonRowCount, 0);
});

test("common cohort output is deterministic", () => {
  const input = {
    marketSources: marketSources(),
    historicalTraining: historicalTraining(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  };
  const first = evaluateN2CommonCohort(input);
  const second = evaluateN2CommonCohort(input);
  assert.equal(first.outputDigest, second.outputDigest);
  assert.equal(first.comparisonDigest, second.comparisonDigest);
  assert.deepEqual(first.baselineMetrics, second.baselineMetrics);
});
