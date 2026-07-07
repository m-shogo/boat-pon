import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyResearchReportAggregatePresentation } from "./dailyResearchReportBuilder";
import { isDeterministic, isJsonSerializable } from "./presentationValidation";
import { buildMultiRuleDailyResearchReport } from "../domain/dailyResearchReport";
import { buildDriftDetectionViewModel } from "../view-models/driftViewModel.adapters";
import type { DriftDetectionResult } from "../domain/researchDrift";
import type { RuleEvaluationResult, RuleStatus } from "../domain/researchRule";

// 全て固定値のフィクスチャ。Date.now()等は使わず、スナップショットが実行のたびに変わらないようにする。

function roiEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "shared-adhoc",
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
    ruleId: "shared-adhoc",
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
    warnings: ["forward window has 2 unsettled rows"],
    evaluatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

function ruleInput(
  ruleId: string,
  status: RuleStatus,
  overrides: { roi?: Partial<RuleEvaluationResult>; drift?: Partial<DriftDetectionResult> } = {},
) {
  return {
    ruleId,
    title: `title-${ruleId}`,
    status,
    roiEvaluation: roiEvaluation(overrides.roi),
    driftResult: driftResult(overrides.drift),
  };
}

function buildAggregatePresentation(
  rules: ReturnType<typeof ruleInput>[] = [ruleInput("rule-a", "forward")],
) {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules,
  });
  const driftViews = aggregate.ruleReports.map((ruleReport, index) =>
    buildDriftDetectionViewModel(
      { ...rules[index].driftResult, ruleId: ruleReport.ruleId },
      ruleReport.status ? { title: ruleReport.title ?? undefined, status: ruleReport.status } : undefined,
    ),
  );
  return buildDailyResearchReportAggregatePresentation(aggregate, driftViews);
}

const ALLOWED_TOP_LEVEL_KEYS = new Set(["reportDate", "generatedAt", "rules", "summary", "overallNextActions"]);

const ALLOWED_RULE_KEYS = new Set([
  "ruleId", "title", "status", "roiSummary", "driftSummary", "warnings", "findings", "nextActions",
  "isProductionEligible", "isForwardTested",
]);

const ALLOWED_SUMMARY_KEYS = new Set([
  "totalRules", "criticalDriftCount", "warningDriftCount", "unknownDriftCount", "forwardUntestedCount", "nonProductionStatusCount",
]);

test("reportDate/generatedAtがそのまま反映される", () => {
  const presentation = buildAggregatePresentation();
  assert.equal(presentation.reportDate, "2026-07-06");
  assert.equal(presentation.generatedAt, "2026-07-06T00:00:00.000Z");
});

test("複数ルールが並ぶ", () => {
  const presentation = buildAggregatePresentation([
    ruleInput("rule-a", "forward"),
    ruleInput("rule-b", "production"),
  ]);
  assert.equal(presentation.rules.length, 2);
  assert.equal(presentation.rules[0].ruleId, "rule-a");
  assert.equal(presentation.rules[1].ruleId, "rule-b");
});

test("各ルールのdriftSummaryは既存のDriftDetectionPresentationと同じ形になる", () => {
  const presentation = buildAggregatePresentation();
  assert.equal(presentation.rules[0].driftSummary.severity, "watch");
  assert.equal(presentation.rules[0].driftSummary.severityLabel, "Watch");
  assert.equal(presentation.rules[0].driftSummary.ruleTitle, "title-rule-a");
});

test("statusがproduction以外ならruleStatusにそのまま反映され、production扱いされない", () => {
  const presentation = buildAggregatePresentation([ruleInput("rule-a", "candidate")]);
  assert.equal(presentation.rules[0].status, "candidate");
  assert.notEqual(presentation.rules[0].status, "production");
  assert.ok(presentation.rules[0].findings.some((f) => f.id === "rule-status-not-production"));
});

test("各ルールのPresentationは想定外キーを持たない", () => {
  const presentation = buildAggregatePresentation();
  assert.deepEqual(new Set(Object.keys(presentation.rules[0])), ALLOWED_RULE_KEYS);
});

test("最上位・summaryのPresentationは想定外キーを持たない", () => {
  const presentation = buildAggregatePresentation();
  assert.deepEqual(new Set(Object.keys(presentation)), ALLOWED_TOP_LEVEL_KEYS);
  assert.deepEqual(new Set(Object.keys(presentation.summary)), ALLOWED_SUMMARY_KEYS);
});

test("summaryの件数はdomain側の集計をそのまま反映する（再計算しない）", () => {
  const presentation = buildAggregatePresentation([
    ruleInput("rule-critical", "forward", { drift: { severity: "critical" } }),
    ruleInput("rule-none", "production", { drift: { severity: "none" } }),
  ]);
  assert.equal(presentation.summary.totalRules, 2);
  assert.equal(presentation.summary.criticalDriftCount, 1);
});

test("Presentationはシリアライズ可能である", () => {
  const presentation = buildAggregatePresentation();
  assert.ok(isJsonSerializable(presentation));
});

test("同じ入力なら同じPresentation JSONになる（決定的）", () => {
  assert.ok(isDeterministic(() => buildAggregatePresentation()));
});

test("overallNextActionsは常に購入推奨・自動採用ではない旨を含む", () => {
  const presentation = buildAggregatePresentation();
  assert.ok(presentation.overallNextActions.some((a) => a.includes("購入推奨") && a.includes("自動採用")));
});

test("ルール0件でも壊れない", () => {
  const presentation = buildAggregatePresentation([]);
  assert.equal(presentation.rules.length, 0);
  assert.equal(presentation.summary.totalRules, 0);
});
