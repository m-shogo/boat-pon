import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import {
  evaluateN2EconomicMetrics,
  type N2EconomicEvaluationRace,
} from "./n2EconomicMetricsEvaluation";

const selections = enumerateBetSelections("trifecta");
const winner = selections[0];
const wrong = selections[1];

function probabilityMap(topSelection: string): Record<string, number> {
  return Object.fromEntries(selections.map((selection) => [
    selection,
    selection === topSelection ? 0.2 : 0.001,
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
    decisionCutoff: `${date}T${String(3 + Math.floor(index / 5)).padStart(2, "0")}:30:00.000Z`,
    winningSelection: winner,
    payoutYen: 1000,
    marketOddsBySelection: oddsMap(),
    probabilityByBaseline: {
      market: probabilityMap(winner),
      historical: probabilityMap(winner),
      legacy: probabilityMap(winner),
    },
  };
}

test("economic drawdown orders equal-cutoff races by numeric race number", () => {
  const races = Array.from({ length: 20 }, (_, index) => race(index));
  races[8].probabilityByBaseline.historical = probabilityMap(wrong); // R9
  races[9].probabilityByBaseline.historical = probabilityMap(wrong); // R10

  assert.equal(races[7].decisionCutoff, races[8].decisionCutoff);
  assert.equal(races[8].decisionCutoff, races[9].decisionCutoff);

  const report = evaluateN2EconomicMetrics({ races: [...races].reverse() });
  assert.equal(report.status, "PASS");
  const historical = report.metricsByBaseline.historical.forcedTop1;
  assert.equal(historical.maxDrawdownYen, 200);
  assert.equal(historical.maxDrawdownStakeUnits, 2);
});
