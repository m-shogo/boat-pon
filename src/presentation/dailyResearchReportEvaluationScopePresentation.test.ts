import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyResearchReportAggregatePresentation } from "./dailyResearchReportBuilder";
import { isJsonSerializable } from "./presentationValidation";
import { buildMultiRuleDailyResearchReport } from "../domain/dailyResearchReport";
import { buildDriftDetectionViewModel } from "../view-models/driftViewModel.adapters";
import type { DriftDetectionResult } from "../domain/researchDrift";
import type { RuleEvaluationResult } from "../domain/researchRule";

// 全て固定値のフィクスチャ。Date.now()等は使わず、スナップショットが実行のたびに変わらないようにする。

function roiEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "rule-a",
    metadata: {
      dataWindowStart: "1970-01-01",
      dataWindowEnd: "2026-07-06",
      evaluationRunAt: "2026-07-06T00:00:00.000Z",
      sampleSize: 250,
    },
    hitRate: 0.24,
    roi: 1.02,
    confidence: 0.83,
    maxDrawdown: 0.12,
    isForwardTested: true,
    isProductionEligible: true,
    reasonSummary: "roi explorer summary",
    warnings: [],
    ...overrides,
  };
}

function driftResult(overrides: Partial<DriftDetectionResult> = {}): DriftDetectionResult {
  return {
    ruleId: "rule-a",
    baselineWindow: { dataWindowStart: "2025-01-01", dataWindowEnd: "2025-12-31", sampleSize: 200 },
    recentWindow: { dataWindowStart: "2026-06-07", dataWindowEnd: "2026-07-06", sampleSize: 40 },
    baselineRoi: 1.05,
    recentRoi: 0.98,
    roiDelta: -0.07,
    baselineHitRate: 0.22,
    recentHitRate: 0.2,
    hitRateDelta: -0.02,
    baselineSampleSize: 200,
    recentSampleSize: 40,
    severity: "watch",
    signals: [{ id: "roiDriftWatch", severity: "watch", message: "recent roi dropped slightly" }],
    warnings: [],
    evaluatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

test("rule-specific評価はisRuleSpecificEvaluation=trueとconditionSummaryを反映する", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      {
        ruleId: "rule-a",
        title: "wind24-exh1",
        status: "forward",
        roiEvaluation: roiEvaluation(),
        driftResult: driftResult(),
        evaluationScope: "rule-specific",
        conditionSummary: ["venue equals \"桐生\""],
        conditionWarnings: [],
      },
    ],
  });
  const driftViews = [buildDriftDetectionViewModel(driftResult(), { title: "wind24-exh1", status: "forward" })];
  const presentation = buildDailyResearchReportAggregatePresentation(aggregate, driftViews);

  const rule = presentation.rules[0];
  assert.equal(rule.evaluationScope, "rule-specific");
  assert.equal(rule.isRuleSpecificEvaluation, true);
  assert.deepEqual(rule.conditionSummary, ["venue equals \"桐生\""]);
  assert.deepEqual(rule.conditionWarnings, []);
  assert.ok(!rule.warnings.some((w) => w.id === "not-rule-specific-filter"));
});

test("shared-fallback評価はisRuleSpecificEvaluation=falseになり、not-rule-specific-filter警告が残る", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      {
        ruleId: "rule-a",
        title: "no-condition-rule",
        status: "candidate",
        roiEvaluation: roiEvaluation(),
        driftResult: driftResult(),
        evaluationScope: "shared-fallback",
      },
    ],
  });
  const driftViews = [buildDriftDetectionViewModel(driftResult(), { title: "no-condition-rule", status: "candidate" })];
  const presentation = buildDailyResearchReportAggregatePresentation(aggregate, driftViews);

  const rule = presentation.rules[0];
  assert.equal(rule.evaluationScope, "shared-fallback");
  assert.equal(rule.isRuleSpecificEvaluation, false);
  assert.ok(rule.warnings.some((w) => w.id === "not-rule-specific-filter"));
});

test("invalid-condition-fallback評価はconditionWarningsを保持し、shared-fallbackとは別の理由になる", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      {
        ruleId: "rule-a",
        title: "bad-condition-rule",
        status: "candidate",
        roiEvaluation: roiEvaluation(),
        driftResult: driftResult(),
        evaluationScope: "invalid-condition-fallback",
        conditionWarnings: ["unknown evaluation condition key \"windSpeed\"; condition ignored"],
      },
    ],
  });
  const driftViews = [buildDriftDetectionViewModel(driftResult(), { title: "bad-condition-rule", status: "candidate" })];
  const presentation = buildDailyResearchReportAggregatePresentation(aggregate, driftViews);

  const rule = presentation.rules[0];
  assert.equal(rule.evaluationScope, "invalid-condition-fallback");
  assert.equal(rule.isRuleSpecificEvaluation, false);
  assert.deepEqual(rule.conditionWarnings, ["unknown evaluation condition key \"windSpeed\"; condition ignored"]);
  const warning = rule.warnings.find((w) => w.id === "not-rule-specific-filter");
  assert.ok(warning);
  assert.match(warning?.message ?? "", /none were valid/);
});

test("Phase 5.2フィールドを含んでもPresentationはシリアライズ可能である", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      {
        ruleId: "rule-a",
        roiEvaluation: roiEvaluation(),
        driftResult: driftResult(),
        evaluationScope: "rule-specific",
        conditionSummary: ["venue equals \"桐生\""],
        conditionWarnings: [],
      },
    ],
  });
  const driftViews = [buildDriftDetectionViewModel(driftResult())];
  const presentation = buildDailyResearchReportAggregatePresentation(aggregate, driftViews);
  assert.ok(isJsonSerializable(presentation));
});
