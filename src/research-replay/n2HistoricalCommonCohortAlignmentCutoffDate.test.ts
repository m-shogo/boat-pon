import assert from "node:assert/strict";
import test from "node:test";

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

test("historical alignment rejects a canonical cutoff outside the race's JST date", () => {
  const races = evaluation();
  const base = buildN2HistoricalOnlyBaselineDataset({ training: training(), evaluationRaces: races });
  assert.equal(base.status, "PASS");
  const map = cutoffs(races);
  map["2026-08-07:05:R1"] = "2026-08-08T03:30:00.000Z";

  const aligned = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: base,
    decisionCutoffByRaceKey: map,
  });

  assert.equal(aligned.status, "BLOCKED");
  assert.ok(aligned.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_OUTSIDE_RACE_DATE"));
  assert.equal(aligned.dataset.rowCount, 0);
});

test("historical alignment accepts a UTC instant inside the race's JST date", () => {
  const races = evaluation();
  const base = buildN2HistoricalOnlyBaselineDataset({ training: training(), evaluationRaces: races });
  assert.equal(base.status, "PASS");
  const map = cutoffs(races);
  map["2026-08-07:05:R1"] = "2026-08-06T16:00:00.000Z";

  const aligned = alignN2HistoricalBaselineToDecisionCutoffs({
    dataset: base,
    decisionCutoffByRaceKey: map,
  });

  assert.equal(aligned.status, "PASS");
});
