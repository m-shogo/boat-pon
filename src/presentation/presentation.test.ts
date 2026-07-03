import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLifecyclePresentation,
  buildOpportunityPresentation,
  buildResearchPresentation,
  buildRulePresentation,
  buildWarningPresentation,
} from "./presentationBuilder";
import {
  isDeterministic,
  isJsonSerializable,
  validateLifecyclePresentation,
  validateOpportunityPresentation,
  validateResearchSummaryPresentation,
  validateRuleCardPresentation,
  validateWarningPresentation,
} from "./presentationValidation";
import {
  buildLifecycleStepViewModel,
  buildOpportunityScoreViewModel,
  buildResearchSummaryViewModel,
  buildRuleCardViewModel,
  buildWarningBadges,
} from "../view-models/researchViewModel.adapters";
import { MIN_PRODUCTION_CONFIDENCE, MIN_PRODUCTION_SAMPLE_SIZE } from "../domain/researchRuleLifecycle";
import type { ResearchRule, RuleEvaluationResult } from "../domain/researchRule";

// 全て固定値のフィクスチャ。Date.now()等は使わず、スナップショットが
// 実行のたびに変わらないようにする。

function rule(overrides: Partial<ResearchRule> = {}): ResearchRule {
  return {
    ruleId: "wind24-exh1-switch",
    status: "approved",
    createdAt: "2026-01-01T00:00:00+09:00",
    updatedAt: "2026-06-01T00:00:00+09:00",
    reasonSummary: "wind speed 2-4 and boat1 exhibition rank 1",
    warnings: [],
    ...overrides,
  };
}

function evaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "wind24-exh1-switch",
    metadata: {
      dataWindowStart: "2026-01-01",
      dataWindowEnd: "2026-06-01",
      evaluationRunAt: "2026-06-02T00:00:00+09:00",
      sampleSize: MIN_PRODUCTION_SAMPLE_SIZE,
    },
    hitRate: 0.32,
    roi: 1.12,
    confidence: MIN_PRODUCTION_CONFIDENCE,
    maxDrawdown: 0.15,
    isForwardTested: true,
    isProductionEligible: true,
    reasonSummary: "forward n=200, top2-excluded ROI >= 100%",
    warnings: [],
    ...overrides,
  };
}

test("Rule Card スナップショット", () => {
  const card = buildRulePresentation(buildRuleCardViewModel(rule(), evaluation()));
  assert.deepEqual(card, {
    id: "wind24-exh1-switch",
    title: "wind24-exh1-switch",
    status: "approved",
    scoreLabel: "★★★★☆",
    roi: 1.12,
    hitRate: 0.32,
    sampleSize: 200,
    confidence: 0.8,
    riskLevel: "low",
    warnings: [],
    reasonSummary: "forward n=200, top2-excluded ROI >= 100%",
    lifecycle: {
      steps: [
        { id: "candidate", label: "Candidate", isCompleted: true, isCurrent: false },
        { id: "backtest", label: "Backtest", isCompleted: true, isCurrent: false },
        { id: "forward", label: "Forward Test", isCompleted: true, isCurrent: false },
        { id: "review", label: "Review", isCompleted: true, isCurrent: false },
        { id: "approved", label: "Approved", isCompleted: false, isCurrent: true },
        { id: "production", label: "Production", isCompleted: false, isCurrent: false },
      ],
      currentStepId: "approved",
    },
    metrics: [
      { id: "roi", label: "ROI", value: 1.12, displayValue: "112.0%" },
      { id: "hitRate", label: "Hit rate", value: 0.32, displayValue: "32.0%" },
      { id: "sampleSize", label: "Sample size", value: 200, displayValue: "200" },
      { id: "confidence", label: "Confidence", value: 0.8, displayValue: "0.800" },
      { id: "maxDrawdown", label: "Max drawdown", value: 0.15, displayValue: "15.0%" },
    ],
    opportunity: {
      score: 4,
      scoreLabel: "★★★★☆",
      riskLevel: "low",
      summary: "forward n=200, top2-excluded ROI >= 100%",
    },
    isForwardTested: true,
    isProductionEligible: true,
    updatedAt: "2026-06-01T00:00:00+09:00",
  });
  assert.deepEqual(validateRuleCardPresentation(card), { ok: true, issues: [] });
});

test("Rule Card スナップショット（Forward未通過・sampleSize不足のwarning付き）", () => {
  const card = buildRulePresentation(
    buildRuleCardViewModel(
      rule({ status: "candidate" }),
      evaluation({
        isForwardTested: false,
        metadata: { ...evaluation().metadata, sampleSize: 10 },
        confidence: 0.2,
        warnings: ["1 settled BUY row(s) lack payout_yen; used current_odds-based ROI"],
      }),
    ),
  );
  assert.equal(card.status, "candidate");
  assert.equal(card.isForwardTested, false);
  assert.equal(card.isProductionEligible, false);
  assert.equal(card.riskLevel, "high");
  assert.deepEqual(
    card.warnings.map((warning) => warning.id),
    ["sample-size", "confidence", "forward-test", "source-0"],
  );
  assert.deepEqual(validateRuleCardPresentation(card), { ok: true, issues: [] });
});

test("Opportunity スナップショット", () => {
  const opportunity = buildOpportunityPresentation(buildOpportunityScoreViewModel(evaluation()));
  assert.deepEqual(opportunity, {
    score: 4,
    scoreLabel: "★★★★☆",
    riskLevel: "low",
    summary: "forward n=200, top2-excluded ROI >= 100%",
  });
  assert.deepEqual(validateOpportunityPresentation(opportunity), { ok: true, issues: [] });
});

test("Warnings スナップショット", () => {
  const warnings = buildWarningPresentation(
    buildWarningBadges(evaluation({ metadata: { ...evaluation().metadata, sampleSize: 5 } })),
  );
  assert.deepEqual(warnings, [
    { id: "sample-size", label: "Sample size", severity: "warning", message: "sample size 5 is below the production minimum 200" },
  ]);
  for (const warning of warnings) {
    assert.deepEqual(validateWarningPresentation(warning), { ok: true, issues: [] });
  }
});

test("Lifecycle スナップショット", () => {
  const lifecycle = buildLifecyclePresentation(buildLifecycleStepViewModel(rule({ status: "forward" })));
  assert.deepEqual(lifecycle, {
    steps: [
      { id: "candidate", label: "Candidate", isCompleted: true, isCurrent: false },
      { id: "backtest", label: "Backtest", isCompleted: true, isCurrent: false },
      { id: "forward", label: "Forward Test", isCompleted: false, isCurrent: true },
      { id: "review", label: "Review", isCompleted: false, isCurrent: false },
      { id: "approved", label: "Approved", isCompleted: false, isCurrent: false },
      { id: "production", label: "Production", isCompleted: false, isCurrent: false },
    ],
    currentStepId: "forward",
  });
  assert.deepEqual(validateLifecyclePresentation(lifecycle), { ok: true, issues: [] });
});

test("Research Summary / Daily Report スナップショット", () => {
  const cardA = buildRuleCardViewModel(rule(), evaluation());
  const cardB = buildRuleCardViewModel(
    rule({ ruleId: "suminoe-odds40-49", status: "review" }),
    evaluation({ ruleId: "suminoe-odds40-49", isForwardTested: false, metadata: { ...evaluation().metadata, sampleSize: 23 } }),
  );
  const summary = buildResearchPresentation(buildResearchSummaryViewModel([cardA, cardB], "2026-07-03T00:00:00Z"));

  assert.equal(summary.generatedAt, "2026-07-03T00:00:00Z");
  assert.equal(summary.ruleCards.length, 2);
  assert.equal(summary.ruleCards[0].id, "wind24-exh1-switch");
  assert.equal(summary.ruleCards[1].id, "suminoe-odds40-49");
  assert.equal(summary.totalWarnings, summary.ruleCards[0].warnings.length + summary.ruleCards[1].warnings.length);
  assert.deepEqual(validateResearchSummaryPresentation(summary), { ok: true, issues: [] });
});

test("Presentation Layer は素のDBエンティティの混入を検知できる", () => {
  const card = buildRulePresentation(buildRuleCardViewModel(rule(), evaluation()));
  const polluted = { ...card, race_id: "leaked-from-decision-history" };
  const result = validateRuleCardPresentation(polluted as never);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("unexpected keys")));
});

test("Presentation Layer はシリアライズ不可な値を検知できる", () => {
  const card = buildRulePresentation(buildRuleCardViewModel(rule(), evaluation()));
  const brokenReasonSummary = { ...card, reasonSummary: undefined as unknown as string };
  assert.equal(isJsonSerializable(brokenReasonSummary), false);
});

test("同じ入力なら同じPresentation JSONになる（決定的）", () => {
  const inputRule = rule();
  const inputEvaluation = evaluation();
  assert.ok(isDeterministic(() => buildRulePresentation(buildRuleCardViewModel(inputRule, inputEvaluation))));
});
