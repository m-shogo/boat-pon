import assert from "node:assert/strict";
import test from "node:test";
import {
  applyResearchRuleConditions,
  describeResearchRuleConditions,
  determineEvaluationScope,
  hasRuleSpecificConditions,
  validateResearchRuleConditions,
} from "./researchRuleConditions";
import type { DecisionHistoryRow } from "./backtest";
import type { ResearchRuleEvaluationCondition } from "./researchRule";

function row(overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id: 1,
    raceId: "r1",
    date: "2026-01-01",
    venue: "桐生",
    raceNo: 1,
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
    result: "1-2-3",
    payoutYen: 500,
    popularity: 5,
    returned: false,
    source: "fixture",
    fetchedAt: "x",
    createdAt: "x",
    ...overrides,
  };
}

test("operatorがequals以外はwarningになり無視される（throwしない）", () => {
  const conditions = [{ key: "venue", operator: "between" as unknown as "equals", value: "桐生" }];
  const { validConditions, warnings } = validateResearchRuleConditions(conditions);
  assert.equal(validConditions.length, 0);
  assert.match(warnings[0], /unsupported operator/);
});

test("未知のkeyはwarningになり無視される（throwしない）", () => {
  const conditions: ResearchRuleEvaluationCondition[] = [{ key: "windSpeed", operator: "equals", value: 3 }];
  const { validConditions, warnings } = validateResearchRuleConditions(conditions);
  assert.equal(validConditions.length, 0);
  assert.match(warnings[0], /unknown evaluation condition key/);
});

test("対応keyのequals条件は有効なconditionとして残る", () => {
  const conditions: ResearchRuleEvaluationCondition[] = [{ key: "venue", operator: "equals", value: "桐生" }];
  const { validConditions, warnings } = validateResearchRuleConditions(conditions);
  assert.equal(validConditions.length, 1);
  assert.equal(warnings.length, 0);
});

test("conditions未指定はshared-fallback", () => {
  assert.equal(determineEvaluationScope(undefined), "shared-fallback");
  assert.equal(determineEvaluationScope([]), "shared-fallback");
});

test("有効な条件がすべて無効ならinvalid-condition-fallback", () => {
  const conditions: ResearchRuleEvaluationCondition[] = [{ key: "unknownKey", operator: "equals", value: "x" }];
  assert.equal(determineEvaluationScope(conditions), "invalid-condition-fallback");
});

test("有効な条件が1つでもあればrule-specific", () => {
  const conditions: ResearchRuleEvaluationCondition[] = [
    { key: "venue", operator: "equals", value: "桐生" },
    { key: "unknownKey", operator: "equals", value: "x" },
  ];
  assert.equal(determineEvaluationScope(conditions), "rule-specific");
});

test("hasRuleSpecificConditionsはdetermineEvaluationScopeと整合する", () => {
  assert.equal(hasRuleSpecificConditions(undefined), false);
  assert.equal(hasRuleSpecificConditions([{ key: "unknownKey", operator: "equals", value: "x" }]), false);
  assert.equal(hasRuleSpecificConditions([{ key: "venue", operator: "equals", value: "桐生" }]), true);
});

test("applyResearchRuleConditionsは既存applyConditionを再利用してAND結合する", () => {
  const rows = [
    row({ id: 1, venue: "桐生", raceNo: 1 }),
    row({ id: 2, venue: "桐生", raceNo: 2 }),
    row({ id: 3, venue: "住之江", raceNo: 1 }),
  ];
  const conditions: ResearchRuleEvaluationCondition[] = [
    { key: "venue", operator: "equals", value: "桐生" },
    { key: "raceNo", operator: "equals", value: 1 },
  ];
  const { rows: filtered, warnings } = applyResearchRuleConditions(rows, conditions);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 1);
  assert.equal(warnings.length, 0);
});

test("applyResearchRuleConditionsは対象データを破壊しない", () => {
  const rows = [row({ id: 1, venue: "桐生" }), row({ id: 2, venue: "住之江" })];
  const original = [...rows];
  applyResearchRuleConditions(rows, [{ key: "venue", operator: "equals", value: "桐生" }]);
  assert.deepEqual(rows, original);
});

test("conditions未指定ならrowsをそのまま返す", () => {
  const rows = [row({ id: 1 }), row({ id: 2 })];
  const { rows: filtered, warnings } = applyResearchRuleConditions(rows, undefined);
  assert.equal(filtered.length, 2);
  assert.equal(warnings.length, 0);
});

test("無効な条件のみの場合はrowsをそのまま返し、警告だけ積む", () => {
  const rows = [row({ id: 1 }), row({ id: 2 })];
  const { rows: filtered, warnings } = applyResearchRuleConditions(rows, [
    { key: "unknownKey", operator: "equals", value: "x" },
  ]);
  assert.equal(filtered.length, 2);
  assert.ok(warnings.length > 0);
});

test("describeResearchRuleConditionsは有効な条件だけを表示用文字列にする", () => {
  const conditions: ResearchRuleEvaluationCondition[] = [
    { key: "venue", operator: "equals", value: "桐生" },
    { key: "unknownKey", operator: "equals", value: "x" },
  ];
  const summary = describeResearchRuleConditions(conditions);
  assert.equal(summary.length, 1);
  assert.match(summary[0], /venue equals/);
});
