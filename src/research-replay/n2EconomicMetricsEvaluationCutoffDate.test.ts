import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import {
  evaluateN2EconomicMetrics,
  type N2EconomicEvaluationRace,
} from "./n2EconomicMetricsEvaluation";

const selections = enumerateBetSelections("trifecta");
const winner = selections[0];

function probabilityMap(): Record<string, number> {
  return Object.fromEntries(selections.map((selection) => [
    selection,
    selection === winner ? 0.2 : 0.001,
  ]));
}

function oddsMap(): Record<string, number> {
  return Object.fromEntries(selections.map((selection) => [selection, 10]));
}

function race(index: number): N2EconomicEvaluationRace {
  const date = index < 10 ? "2026-08-07" : "2026-08-08";
  const raceNo = (index % 10) + 1;
  return {
    canonicalRaceKey: `${date}:05:R${raceNo}`,
    decisionCutoff: `${date}T03:30:00.000Z`,
    winningSelection: winner,
    payoutYen: 1000,
    marketOddsBySelection: oddsMap(),
    probabilityByBaseline: {
      market: probabilityMap(),
      historical: probabilityMap(),
      legacy: probabilityMap(),
    },
  };
}

function twentyRaces(): N2EconomicEvaluationRace[] {
  return Array.from({ length: 20 }, (_, index) => race(index));
}

test("economic evaluation rejects a canonical cutoff outside the race's JST date", () => {
  const races = twentyRaces();
  races[0].decisionCutoff = "2026-08-08T03:30:00.000Z";

  const report = evaluateN2EconomicMetrics({ races });

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_OUTSIDE_RACE_DATE"));
  assert.deepEqual(report.metricsByBaseline, {});
});

test("economic evaluation accepts a UTC cutoff whose instant is inside the race's JST date", () => {
  const races = twentyRaces();
  races[0].decisionCutoff = "2026-08-06T16:00:00.000Z";

  const report = evaluateN2EconomicMetrics({ races });

  assert.equal(report.status, "PASS");
});
