import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionRuleStatus,
  MIN_PRODUCTION_CONFIDENCE,
  MIN_PRODUCTION_SAMPLE_SIZE,
  validateProductionEligibility,
} from "./researchRuleLifecycle";
import type { ForwardTestResult, ResearchRule, RuleStatus } from "./researchRule";

function rule(status: RuleStatus): ResearchRule {
  return {
    ruleId: "rule-1",
    status,
    createdAt: "2026-01-01T00:00:00+09:00",
    updatedAt: "2026-01-01T00:00:00+09:00",
    reasonSummary: "test rule",
    warnings: [],
  };
}

function forwardResult(overrides: Partial<ForwardTestResult> = {}): ForwardTestResult {
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
    ...overrides,
  };
}

test("Forward未通過ルールはProduction不可", () => {
  const evaluation: ForwardTestResult = { ...forwardResult(), isForwardTested: false as unknown as true };
  const result = validateProductionEligibility(rule("approved"), evaluation);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("forward test")));
});

test("sampleSize不足ならProduction不可", () => {
  const evaluation = forwardResult({
    metadata: { ...forwardResult().metadata, sampleSize: MIN_PRODUCTION_SAMPLE_SIZE - 1 },
  });
  const result = validateProductionEligibility(rule("approved"), evaluation);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.includes("sample size")));
});

test("CandidateからProductionへ直接遷移不可", () => {
  assert.equal(canTransitionRuleStatus("candidate", "production"), false);
  assert.equal(canTransitionRuleStatus("backtest", "production"), false);
  assert.equal(canTransitionRuleStatus("forward", "production"), false);
  assert.equal(canTransitionRuleStatus("review", "production"), false);
});

test("ApprovedからProductionは条件を満たせば可能", () => {
  assert.equal(canTransitionRuleStatus("approved", "production"), true);
  const result = validateProductionEligibility(rule("approved"), forwardResult());
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test("Archiveされたルールは削除ではなく保持前提（そこからは遷移できない）", () => {
  assert.equal(canTransitionRuleStatus("archived", "candidate"), false);
  assert.equal(canTransitionRuleStatus("archived", "production"), false);
  assert.equal(canTransitionRuleStatus("archived", "deprecated"), false);
  assert.equal(canTransitionRuleStatus("deprecated", "archived"), true);
});
