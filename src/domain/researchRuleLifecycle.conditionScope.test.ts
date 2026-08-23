import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PRODUCTION_CONFIDENCE,
  MIN_PRODUCTION_SAMPLE_SIZE,
  validateProductionEligibility,
} from "./researchRuleLifecycle";
import type { ForwardTestResult, ResearchRule, ResearchRuleEvaluationCondition } from "./researchRule";

function approvedRule(evaluationConditions?: ResearchRuleEvaluationCondition[]): ResearchRule {
  return {
    ruleId: "rule-1",
    status: "approved",
    createdAt: "2026-01-01T00:00:00+09:00",
    updatedAt: "2026-06-02T00:00:00+09:00",
    reasonSummary: "test rule",
    warnings: [],
    ...(evaluationConditions === undefined ? {} : { evaluationConditions }),
  };
}

function forwardResult(): ForwardTestResult {
  return {
    ruleId: "rule-1",
    metadata: {
      dataWindowStart: "2026-01-01",
      dataWindowEnd: "2026-06-01",
      evaluationRunAt: "2026-06-02T00:00:00+09:00",
      sampleSize: MIN_PRODUCTION_SAMPLE_SIZE,
    },
    hitRate: 0.3,
    roi: 1.1,
    confidence: MIN_PRODUCTION_CONFIDENCE,
    maxDrawdown: 0.2,
    isForwardTested: true,
    isProductionEligible: true,
    reasonSummary: "forward test passed",
    warnings: [],
  };
}

test("条件未指定のapproved ruleは従来どおりproduction eligibilityを評価できる", () => {
  const result = validateProductionEligibility(approvedRule(), forwardResult());
  assert.equal(result.eligible, true);
});

test("valid rule-specific conditionはproduction eligibilityを直ちに拒否しない", () => {
  const result = validateProductionEligibility(
    approvedRule([{ key: "venue", operator: "equals", value: "桐生" }]),
    forwardResult(),
  );
  assert.equal(result.eligible, true);
});

test("unsupported conditionしかないruleはshared fallbackでProductionへ昇格できない", () => {
  const result = validateProductionEligibility(
    approvedRule([{ key: "venue", operator: "contains" as "equals", value: "桐生" }]),
    forwardResult(),
  );
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("evaluationConditions are invalid")));
});

test("runtimeで壊れたcondition shapeもgeneric forward evidenceへfallbackしてProduction不可", () => {
  const malformedRule = {
    ...approvedRule(),
    evaluationConditions: { key: "venue", operator: "equals", value: "桐生" },
  } as unknown as ResearchRule;
  const result = validateProductionEligibility(malformedRule, forwardResult());
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("evaluationConditions are invalid")));
});
