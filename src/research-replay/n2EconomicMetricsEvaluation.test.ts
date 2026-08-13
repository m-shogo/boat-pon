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

function probabilityMap(topSelection: string, topProbability: number, fallback = 0.001): Record<string, number> {
  return Object.fromEntries(selections.map((selection) => [
    selection,
    selection === topSelection ? topProbability : fallback,
  ]));
}

function marketProbabilityMap(): Record<string, number> {
  return Object.fromEntries(selections.map((selection) => [selection, 0.1]));
}

function marketOddsMap(): Record<string, number> {
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
    marketOddsBySelection: marketOddsMap(),
    probabilityByBaseline: {
      market: marketProbabilityMap(),
      historical: probabilityMap(index < 10 ? wrong : winner, 0.2),
      legacy: probabilityMap(winner, 0.15),
    },
  };
}

function twentyRaces(): N2EconomicEvaluationRace[] {
  return Array.from({ length: 20 }, (_, index) => race(index));
}

test("economic metrics fix return-rate, net ROI, coverage, and drawdown semantics", () => {
  const report = evaluateN2EconomicMetrics({ races: [...twentyRaces()].reverse() });
  assert.equal(report.status, "PASS");
  assert.equal(report.raceCount, 20);
  assert.equal(report.baselineCount, 3);

  const historical = report.metricsByBaseline.historical.forcedTop1;
  assert.equal(historical.betRaceCount, 20);
  assert.equal(historical.betCoverage, 1);
  assert.equal(historical.hitCount, 10);
  assert.equal(historical.totalStakeYen, 2000);
  assert.equal(historical.totalReturnYen, 10000);
  assert.equal(historical.netProfitYen, 8000);
  assert.equal(historical.returnRatePct, 500);
  assert.equal(historical.netRoiPct, 400);
  assert.equal(historical.maxDrawdownYen, 1000);
  assert.equal(historical.maxDrawdownStakeUnits, 10);

  const legacy = report.metricsByBaseline.legacy.forcedTop1;
  assert.equal(legacy.hitCount, 20);
  assert.equal(legacy.returnRatePct, 1000);
  assert.equal(legacy.netRoiPct, 900);
  assert.equal(legacy.maxDrawdownYen, 0);
});

test("market reciprocal baseline places no positive-EV tickets at exact break-even", () => {
  const report = evaluateN2EconomicMetrics({ races: twentyRaces() });
  assert.equal(report.status, "PASS");
  const positiveEv = report.metricsByBaseline.market.positiveEvTop1;
  assert.equal(positiveEv.betRaceCount, 0);
  assert.equal(positiveEv.betCoverage, 0);
  assert.equal(positiveEv.totalStakeYen, 0);
  assert.equal(positiveEv.totalReturnYen, 0);
  assert.equal(positiveEv.returnRatePct, null);
  assert.equal(positiveEv.netRoiPct, null);
  assert.equal(positiveEv.maxDrawdownYen, 0);
});

test("forced Top1 ranking ignores market odds while positive-EV policy may use them", () => {
  const races = twentyRaces();
  for (const item of races) {
    item.probabilityByBaseline.historical = probabilityMap(winner, 0.2);
    item.marketOddsBySelection[winner] = 2;
    item.marketOddsBySelection[wrong] = 1001;
    item.probabilityByBaseline.historical[wrong] = 0.001;
  }
  const report = evaluateN2EconomicMetrics({ races });
  assert.equal(report.status, "PASS");
  assert.equal(report.metricsByBaseline.historical.forcedTop1.hitCount, 20);
  assert.equal(report.metricsByBaseline.historical.positiveEvTop1.hitCount, 0);
  assert.equal(report.metricsByBaseline.historical.positiveEvTop1.betRaceCount, 20);
});

test("economic evaluation fails closed on incomplete common cohort", () => {
  const report = evaluateN2EconomicMetrics({ races: twentyRaces().slice(0, 19) });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("RACE_COUNT:19/20"));
  assert.deepEqual(report.metricsByBaseline, {});
});

test("economic evaluation fails closed if a baseline lacks one canonical selection", () => {
  const races = twentyRaces();
  delete races[0].probabilityByBaseline.legacy[selections[119]];
  const report = evaluateN2EconomicMetrics({ races });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.some((blocker) => blocker.includes("legacy:PROBABILITY_SELECTION_COUNT:119/120")));
});

test("economic evaluation rejects impossible race-key and cutoff calendar dates", () => {
  const invalidRaceKey = twentyRaces();
  invalidRaceKey[0].canonicalRaceKey = "2026-02-30:05:R1";
  const raceKeyReport = evaluateN2EconomicMetrics({ races: invalidRaceKey });
  assert.equal(raceKeyReport.status, "BLOCKED");
  assert.ok(raceKeyReport.blockers.includes("2026-02-30:05:R1:RACE_KEY_INVALID"));

  const invalidCutoff = twentyRaces();
  invalidCutoff[0].decisionCutoff = "2026-02-30T03:30:00.000Z";
  const cutoffReport = evaluateN2EconomicMetrics({ races: invalidCutoff });
  assert.equal(cutoffReport.status, "BLOCKED");
  assert.ok(cutoffReport.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_INVALID"));
});

test("economic evaluation accepts a real leap-day race and cutoff", () => {
  const races = twentyRaces();
  races[0].canonicalRaceKey = "2028-02-29:05:R1";
  races[0].decisionCutoff = "2028-02-29T03:30:00.000Z";
  const report = evaluateN2EconomicMetrics({ races });
  assert.equal(report.status, "PASS");
});

test("economic evaluation output is deterministic", () => {
  const first = evaluateN2EconomicMetrics({ races: twentyRaces() });
  const second = evaluateN2EconomicMetrics({ races: twentyRaces() });
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.metricsByBaseline, second.metricsByBaseline);
});