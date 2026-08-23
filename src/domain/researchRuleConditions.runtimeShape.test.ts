import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionHistoryRow } from "./backtest";
import type { ResearchRuleEvaluationCondition } from "./researchRule";
import {
  applyResearchRuleConditions,
  determineEvaluationScope,
  validateResearchRuleConditions,
} from "./researchRuleConditions";

const rows = [{ id: 1 } as DecisionHistoryRow, { id: 2 } as DecisionHistoryRow];

function runtimeConditions(value: unknown): ResearchRuleEvaluationCondition[] {
  return value as ResearchRuleEvaluationCondition[];
}

test("non-array evaluationConditionsはthrowせずinvalid fallbackへ倒す", () => {
  const conditions = runtimeConditions({ key: "venue", operator: "equals", value: "桐生" });
  const validation = validateResearchRuleConditions(conditions);
  assert.deepEqual(validation.validConditions, []);
  assert.match(validation.warnings[0], /must be an array/);
  assert.equal(determineEvaluationScope(conditions), "invalid-condition-fallback");

  const applied = applyResearchRuleConditions(rows, conditions);
  assert.deepEqual(applied.rows, rows);
  assert.match(applied.warnings[0], /must be an array/);
});

test("nullやprimitiveのcondition要素はthrowせずwarningへ落とす", () => {
  const conditions = runtimeConditions([
    null,
    "venue=桐生",
    { key: "venue", operator: "equals", value: "桐生" },
  ]);
  const validation = validateResearchRuleConditions(conditions);
  assert.equal(validation.validConditions.length, 1);
  assert.equal(validation.warnings.length, 2);
  assert.match(validation.warnings[0], /index 0.*must be an object/);
  assert.match(validation.warnings[1], /index 1.*must be an object/);
});

test("producer-impossible condition valueは無視し正常conditionだけ適用する", () => {
  const conditions = runtimeConditions([
    { key: "venue", operator: "equals", value: { nested: true } },
    { key: "raceNo", operator: "equals", value: 1 },
  ]);
  const validation = validateResearchRuleConditions(conditions);
  assert.equal(validation.validConditions.length, 1);
  assert.equal(validation.validConditions[0].key, "raceNo");
  assert.match(validation.warnings[0], /finite primitive value/);
});

test("null runtime evaluationConditionsは未指定扱いにせずinvalid fallbackにする", () => {
  const conditions = runtimeConditions(null);
  assert.equal(determineEvaluationScope(conditions), "invalid-condition-fallback");
  const validation = validateResearchRuleConditions(conditions);
  assert.match(validation.warnings[0], /must be an array/);
});
