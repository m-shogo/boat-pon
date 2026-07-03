import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLifecycleStepViewModel,
  buildOpportunityScoreViewModel,
  buildResearchSummaryViewModel,
  buildRuleCardViewModel,
  buildWarningBadges,
  deriveRiskLevel,
  summarizeReason,
} from "./researchViewModel.adapters";
import { MIN_PRODUCTION_CONFIDENCE, MIN_PRODUCTION_SAMPLE_SIZE } from "../domain/researchRuleLifecycle";
import type { ResearchRule, RuleEvaluationResult } from "../domain/researchRule";

function rule(overrides: Partial<ResearchRule> = {}): ResearchRule {
  return {
    ruleId: "rule-1",
    status: "approved",
    createdAt: "2026-01-01T00:00:00+09:00",
    updatedAt: "2026-06-01T00:00:00+09:00",
    reasonSummary: "test rule",
    warnings: [],
    ...overrides,
  };
}

function evaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "rule-1",
    metadata: {
      dataWindowStart: "2026-01-01",
      dataWindowEnd: "2026-06-01",
      evaluationRunAt: "2026-06-02T00:00:00+09:00",
      sampleSize: MIN_PRODUCTION_SAMPLE_SIZE,
    },
    hitRate: 0.3,
    roi: 1.15,
    confidence: MIN_PRODUCTION_CONFIDENCE,
    maxDrawdown: 0.1,
    isForwardTested: true,
    isProductionEligible: true,
    reasonSummary: "forward test passed",
    warnings: [],
    ...overrides,
  };
}

test("Forward未通過のruleはProduction風ViewModelにならない", () => {
  const card = buildRuleCardViewModel(rule({ status: "approved" }), evaluation({ isForwardTested: false }));
  assert.equal(card.isProductionEligible, false);
  assert.ok(card.warnings.some((badge) => badge.id === "forward-test" && badge.severity === "critical"));
});

test("Forward通過かつapproved・sampleSize/confidence十分ならProduction風ViewModelになる", () => {
  const card = buildRuleCardViewModel(rule({ status: "approved" }), evaluation());
  assert.equal(card.isProductionEligible, true);
});

test("sampleSize不足ならwarning badgeが出る", () => {
  const badges = buildWarningBadges(evaluation({ metadata: { ...evaluation().metadata, sampleSize: 10 } }));
  assert.ok(badges.some((badge) => badge.id === "sample-size" && badge.severity === "warning"));
});

test("ROIが高くてもconfidence不足ならriskLevelがhighになりscoreLabelが抑えられる", () => {
  const highRoiLowConfidence = evaluation({ roi: 5.0, confidence: 0.1 });
  assert.equal(deriveRiskLevel(highRoiLowConfidence), "high");

  const opportunity = buildOpportunityScoreViewModel(highRoiLowConfidence);
  assert.equal(opportunity.riskLevel, "high");
  assert.ok(opportunity.score <= 2, `expected capped score, got ${opportunity.score}`);

  const badges = buildWarningBadges(highRoiLowConfidence);
  assert.ok(badges.some((badge) => badge.id === "confidence"));
});

test("sampleSize=0はriskLevel unknownになる", () => {
  assert.equal(deriveRiskLevel(evaluation({ metadata: { ...evaluation().metadata, sampleSize: 0 } })), "unknown");
});

test("sampleSize/confidenceが十分でForward通過済みならriskLevelはlow", () => {
  assert.equal(deriveRiskLevel(evaluation()), "low");
});

test("Forward通過済みでもsampleSize/confidence不足前はmediumではなくhigh", () => {
  // isForwardTested=trueでもsampleSize不足はhigh扱い（confidence/sampleSizeが優先）
  assert.equal(deriveRiskLevel(evaluation({ metadata: { ...evaluation().metadata, sampleSize: 10 } })), "high");
});

test("summarizeReasonは長い文字列を省略記号付きで切り詰める", () => {
  const long = "a".repeat(200);
  const short = summarizeReason(long, 90);
  assert.equal(short.length, 90);
  assert.ok(short.endsWith("…"));
  assert.equal(summarizeReason("short text"), "short text");
});

test("buildLifecycleStepViewModelは現在のstatusをisCurrentにし、それより前をisCompletedにする", () => {
  const steps = buildLifecycleStepViewModel(rule({ status: "review" }));
  const byId = Object.fromEntries(steps.map((step) => [step.id, step]));
  assert.equal(byId.candidate.isCompleted, true);
  assert.equal(byId.backtest.isCompleted, true);
  assert.equal(byId.forward.isCompleted, true);
  assert.equal(byId.review.isCurrent, true);
  assert.equal(byId.review.isCompleted, false);
  assert.equal(byId.approved.isCurrent, false);
  assert.equal(byId.approved.isCompleted, false);
});

test("buildLifecycleStepViewModelはdeprecated/archivedで全ステップ未完了・未current", () => {
  const steps = buildLifecycleStepViewModel(rule({ status: "archived" }));
  assert.ok(steps.every((step) => !step.isCurrent && !step.isCompleted));
});

test("RuleCardViewModelは必須フィールドを全て持つ（--view-json が出力するのと同じ形）", () => {
  const card = buildRuleCardViewModel(rule(), evaluation());
  for (const field of [
    "id", "title", "status", "scoreLabel", "roi", "hitRate", "sampleSize", "confidence",
    "riskLevel", "warnings", "reasonSummary", "lifecycleSteps", "updatedAt",
  ]) {
    assert.ok(field in card, `missing field: ${field}`);
  }
  assert.equal(Array.isArray(card.warnings), true);
  assert.equal(Array.isArray(card.lifecycleSteps), true);
  assert.equal(card.lifecycleSteps.length, 6);
});

test("buildResearchSummaryViewModelはカード配列とtotalWarningsをまとめる", () => {
  const cardA = buildRuleCardViewModel(rule(), evaluation({ isForwardTested: false }));
  const cardB = buildRuleCardViewModel(rule({ ruleId: "rule-2" }), evaluation({ ruleId: "rule-2" }));
  const summary = buildResearchSummaryViewModel([cardA, cardB], "2026-07-03T00:00:00Z");
  assert.equal(summary.ruleCards.length, 2);
  assert.equal(summary.generatedAt, "2026-07-03T00:00:00Z");
  assert.equal(summary.totalWarnings, cardA.warnings.length + cardB.warnings.length);
});
