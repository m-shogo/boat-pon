import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketOnlyBaselineRow,
  compareN2BaselinesOnCommonCohort,
} from "./n2BaselineEvaluation";
import { enumerateBetSelections } from "./n2DatasetContract";
import { alignN2HistoricalBaselineToDecisionCutoffs } from "./n2HistoricalCommonCohortAlignment";
import {
  buildN2HistoricalOnlyBaselineDataset,
  type N2HistoricalEvaluationRace,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";

const selections = enumerateBetSelections("trifecta");

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function training(): N2HistoricalOutcomeRow[] {
  return Array.from({ length: 175 }, (_, index) => ({
    canonicalRaceKey: `${isoDate("2026-08-07", index - 175)}:05:R1`,
    winningSelection: selections[index % selections.length],
  }));
}

function evaluation(): N2HistoricalEvaluationRace[] {
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

function cutoffs(races: N2HistoricalEvaluationRace[]): Record<string, string> {
  return Object.fromEntries(races.map((race) => [
    race.canonicalRaceKey,
    `${race.canonicalRaceKey.slice(0, 10)}T03:30:00.000Z`,
  ]));
}

test("historical rows align to the exact market decision cutoff and become comparable", () => {
  const races = evaluation();
  const base = buildN2HistoricalOnlyBaselineDataset({ training: training(), evaluationRaces: races });
  assert.equal(base.status, "PASS");
  const aligned = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: base,
    decisionCutoffByRaceKey: cutoffs(races),
  });
  assert.equal(aligned.status, "PASS");
  assert.equal(aligned.alignedDecisionCutoffCount, 20);
  assert.ok(aligned.dataset.rows.every((row) =>
    row.decisionCutoff === `${row.canonicalRaceKey.slice(0, 10)}T03:30:00.000Z`,
  ));
  assert.ok(aligned.dataset.rows.every((row) => Date.parse(row.predictionAvailableAt) <= Date.parse(row.decisionCutoff)));

  const marketRows = aligned.dataset.rows.map((historicalRow) => {
    const built = buildMarketOnlyBaselineRow({
      baselineId: "test-market-common-cohort",
      canonicalRaceKey: historicalRow.canonicalRaceKey,
      betType: "trifecta",
      betSelection: historicalRow.betSelection,
      decisionCutoff: historicalRow.decisionCutoff,
      hit: historicalRow.hit,
      odds: 120,
      capturedAt: `${historicalRow.canonicalRaceKey.slice(0, 10)}T03:25:30.000Z`,
      availableAt: `${historicalRow.canonicalRaceKey.slice(0, 10)}T03:25:00.000Z`,
      observationId: `obs-${historicalRow.canonicalRaceKey}-${historicalRow.betSelection}`,
      rawDocumentId: `raw-${historicalRow.canonicalRaceKey}`,
    });
    if (built.status !== "built") assert.fail(built.errors.join(","));
    return built.row;
  });
  const comparison = compareN2BaselinesOnCommonCohort({
    baselines: {
      [aligned.dataset.baselineId]: aligned.dataset.rows,
      "test-market-common-cohort": marketRows,
    },
    minimumCommonRows: 2400,
  });
  assert.equal(comparison.status, "COMPARABLE");
  assert.equal(comparison.commonRowCount, 2400);
  assert.deepEqual(comparison.conflicts, []);
});

test("alignment fails closed when even one market cutoff is missing", () => {
  const races = evaluation();
  const base = buildN2HistoricalOnlyBaselineDataset({ training: training(), evaluationRaces: races });
  const map = cutoffs(races);
  delete map["2026-08-07:05:R1"];
  const aligned = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: base,
    decisionCutoffByRaceKey: map,
  });
  assert.equal(aligned.status, "BLOCKED");
  assert.ok(aligned.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_MISSING_OR_INVALID"));
  assert.equal(aligned.dataset.rowCount, 0);
});

test("alignment rejects an impossible market cutoff calendar date", () => {
  const races = evaluation();
  const base = buildN2HistoricalOnlyBaselineDataset({ training: training(), evaluationRaces: races });
  const map = cutoffs(races);
  map["2026-08-07:05:R1"] = "2026-02-30T03:30:00.000Z";
  const aligned = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: base,
    decisionCutoffByRaceKey: map,
  });
  assert.equal(aligned.status, "BLOCKED");
  assert.ok(aligned.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_MISSING_OR_INVALID"));
  assert.equal(aligned.dataset.rowCount, 0);
});