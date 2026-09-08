import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionHistoryRow } from "./backtest";
import { buildRuleEvaluationResult, computeMaxDrawdown, realizedPayoutYen } from "./researchEvaluation";

function row(id: number, overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id,
    raceId: `r${id}`,
    date: "2026-02-01",
    venue: "蒲郡",
    raceNo: id,
    selection: "1-2-3",
    estimatedHitRate: 0.2,
    requiredOdds: 6,
    currentOdds: 10,
    ev: 1.2,
    decision: "BUY",
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: 100,
    sampleSize: 500,
    result: "2-1-3",
    payoutYen: null,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "2026-02-01T00:00:00+09:00",
    createdAt: "2026-02-01T00:00:00+09:00",
    ...overrides,
  };
}

const evaluationBase = {
  ruleId: "returned-boundary",
  dataWindowStart: "2026-01-01",
  dataWindowEnd: "2026-06-01",
  evaluationRunAt: "2026-06-02T00:00:00+09:00",
};

test("returned BUY rows are excluded from ROI, hit rate, sample size, and drawdown", () => {
  const rows = [
    row(1, { result: "1-2-3", payoutYen: 2000 }),
    row(2, { result: "2-1-3" }),
    row(3, { returned: true, result: "1-2-3", payoutYen: 99900, recommendedStakeYen: 10000 }),
  ];

  const result = buildRuleEvaluationResult({ ...evaluationBase, rows });

  assert.equal(result.metadata.sampleSize, 2);
  assert.equal(result.hitRate, 0.5);
  assert.equal(result.roi, 10);
  assert.equal(result.maxDrawdown, 0.5);
  assert.ok(result.warnings.some((warning) => warning.includes("1 BUY rows are returned and excluded")));
  assert.equal(realizedPayoutYen(rows[2], rows[2].recommendedStakeYen), 0);
  assert.equal(computeMaxDrawdown(rows), 0.5);
});

test("empty result is unsettled rather than a settled loss", () => {
  const result = buildRuleEvaluationResult({
    ...evaluationBase,
    rows: [
      row(1, { result: "1-2-3", payoutYen: 1500 }),
      row(2, { result: "" }),
    ],
  });

  assert.equal(result.metadata.sampleSize, 1);
  assert.equal(result.hitRate, 1);
  assert.equal(result.roi, 15);
  assert.ok(result.warnings.some((warning) => warning.includes("1 BUY rows are unsettled and excluded")));
});
