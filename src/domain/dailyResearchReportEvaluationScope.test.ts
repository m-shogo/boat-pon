import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyResearchRuleReport } from "./dailyResearchReport";
import { MIN_PRODUCTION_SAMPLE_SIZE } from "./researchRuleLifecycle";
import type { DriftDetectionResult } from "./researchDrift";
import type { RuleEvaluationResult } from "./researchRule";

function roiEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "rule-a",
    metadata: {
      dataWindowStart: "1970-01-01",
      dataWindowEnd: "2026-07-06",
      evaluationRunAt: "2026-07-06T00:00:00.000Z",
      sampleSize: MIN_PRODUCTION_SAMPLE_SIZE,
    },
    hitRate: 0.25,
    roi: 1.05,
    confidence: 0.9,
    maxDrawdown: 0.1,
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
    baselineRoi: 1.1,
    recentRoi: 1.05,
    roiDelta: -0.05,
    baselineHitRate: 0.25,
    recentHitRate: 0.24,
    hitRateDelta: -0.01,
    baselineSampleSize: 200,
    recentSampleSize: 40,
    severity: "none",
    signals: [],
    warnings: [],
    evaluatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

test("evaluationScope省略時はshared-fallback扱いになり、not-rule-specific-filter警告が入る（Phase 5.1互換）", () => {
  const report = buildDailyResearchRuleReport({
    ruleId: "rule-a",
    status: "forward",
    roiEvaluation: roiEvaluation(),
    driftResult: driftResult(),
  });
  assert.equal(report.evaluationScope, "shared-fallback");
  assert.equal(report.isRuleSpecificEvaluation, false);
  assert.ok(report.warnings.some((w) => w.id === "not-rule-specific-filter"));
  assert.deepEqual(report.conditionSummary, []);
  assert.deepEqual(report.conditionWarnings, []);
});

test("evaluationScope=rule-specificならnot-rule-specific-filter警告は付かない", () => {
  const report = buildDailyResearchRuleReport({
    ruleId: "rule-a",
    status: "forward",
    roiEvaluation: roiEvaluation(),
    driftResult: driftResult(),
    evaluationScope: "rule-specific",
    conditionSummary: ["venue equals \"桐生\""],
  });
  assert.equal(report.evaluationScope, "rule-specific");
  assert.equal(report.isRuleSpecificEvaluation, true);
  assert.ok(!report.warnings.some((w) => w.id === "not-rule-specific-filter"));
  assert.deepEqual(report.conditionSummary, ["venue equals \"桐生\""]);
});

test("evaluationScope=invalid-condition-fallbackはnot-rule-specific-filter警告が入り、理由が異なる", () => {
  const report = buildDailyResearchRuleReport({
    ruleId: "rule-a",
    status: "forward",
    roiEvaluation: roiEvaluation(),
    driftResult: driftResult(),
    evaluationScope: "invalid-condition-fallback",
    conditionWarnings: ["unknown evaluation condition key \"windSpeed\"; condition ignored"],
  });
  assert.equal(report.evaluationScope, "invalid-condition-fallback");
  assert.equal(report.isRuleSpecificEvaluation, false);
  const warning = report.warnings.find((w) => w.id === "not-rule-specific-filter");
  assert.ok(warning);
  assert.match(warning?.message ?? "", /none were valid/);
  assert.deepEqual(report.conditionWarnings, ["unknown evaluation condition key \"windSpeed\"; condition ignored"]);
});

test("shared-fallbackとinvalid-condition-fallbackのnot-rule-specific-filter文言は異なる", () => {
  const shared = buildDailyResearchRuleReport({
    ruleId: "rule-a",
    roiEvaluation: roiEvaluation(),
    driftResult: driftResult(),
    evaluationScope: "shared-fallback",
  });
  const invalid = buildDailyResearchRuleReport({
    ruleId: "rule-a",
    roiEvaluation: roiEvaluation(),
    driftResult: driftResult(),
    evaluationScope: "invalid-condition-fallback",
  });
  const sharedMsg = shared.warnings.find((w) => w.id === "not-rule-specific-filter")?.message;
  const invalidMsg = invalid.warnings.find((w) => w.id === "not-rule-specific-filter")?.message;
  assert.notEqual(sharedMsg, invalidMsg);
});

test("rule-specificでもFrontward未通過・サンプル不足のfindingは通常通り出る（買い推奨にはならない）", () => {
  const report = buildDailyResearchRuleReport({
    ruleId: "rule-a",
    status: "forward",
    roiEvaluation: roiEvaluation({ isForwardTested: false, metadata: { ...roiEvaluation().metadata, sampleSize: 5 } }),
    driftResult: driftResult(),
    evaluationScope: "rule-specific",
    conditionSummary: ["venue equals \"桐生\""],
  });
  assert.ok(report.findings.some((f) => f.id === "forward-test-not-passed"));
  assert.ok(report.findings.some((f) => f.id === "sample-size-insufficient"));
  for (const finding of report.findings) {
    assert.ok(!finding.detail.includes("買い推奨"));
    assert.ok(!finding.detail.includes("利益確定"));
    assert.ok(!finding.detail.includes("採用確定"));
  }
});
