import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyResearchReportPresentation } from "./dailyResearchReportBuilder";
import { isDeterministic, isJsonSerializable } from "./presentationValidation";
import { buildDailyResearchReport } from "../domain/dailyResearchReport";
import { buildDriftDetectionViewModel } from "../view-models/driftViewModel.adapters";
import type { DriftDetectionResult } from "../domain/researchDrift";
import type { RuleEvaluationResult } from "../domain/researchRule";

// 全て固定値のフィクスチャ。Date.now()等は使わず、スナップショットが実行のたびに変わらないようにする。

function roiEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "daily-research-report-adhoc",
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
    ruleId: "daily-research-report-adhoc",
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

function buildPresentation(overrides: { roi?: Partial<RuleEvaluationResult>; drift?: Partial<DriftDetectionResult> } = {}) {
  const drift = driftResult(overrides.drift);
  const report = buildDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    roiEvaluation: roiEvaluation(overrides.roi),
    driftResult: drift,
  });
  const driftView = buildDriftDetectionViewModel(drift);
  return buildDailyResearchReportPresentation(report, driftView);
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "reportDate", "generatedAt", "roiSummary", "driftSummary", "findings", "warnings", "nextActions", "dataQualityNotes",
]);

const ALLOWED_ROI_KEYS = new Set([
  "ruleId", "dataWindowStart", "dataWindowEnd", "roi", "hitRate", "sampleSize", "confidence",
  "isForwardTested", "isProductionEligible", "reasonSummary",
]);

test("reportDate/generatedAtがそのまま反映される", () => {
  const presentation = buildPresentation();
  assert.equal(presentation.reportDate, "2026-07-06");
  assert.equal(presentation.generatedAt, "2026-07-06T00:00:00.000Z");
});

test("roiSummaryが必須フィールドを持つ", () => {
  const presentation = buildPresentation();
  assert.deepEqual(new Set(Object.keys(presentation.roiSummary)), ALLOWED_ROI_KEYS);
  assert.equal(presentation.roiSummary.roi, 1.02);
  assert.equal(presentation.roiSummary.isForwardTested, true);
});

test("driftSummaryは既存のDriftDetectionPresentationと同じ形になる", () => {
  const presentation = buildPresentation();
  assert.equal(presentation.driftSummary.severity, "watch");
  assert.equal(presentation.driftSummary.severityLabel, "Watch");
  assert.ok(Array.isArray(presentation.driftSummary.signals));
});

test("Forward未通過でも買い推奨の文言を含むfindingにはならない", () => {
  const presentation = buildPresentation({ roi: { isForwardTested: false } });
  const finding = presentation.findings.find((f) => f.id === "forward-test-not-passed");
  assert.ok(finding);
  assert.ok(!finding?.detail.includes("買い推奨"));
});

test("sampleSize不足時は強い結論のfindingにならない（severity=watch止まり）", () => {
  const presentation = buildPresentation({ roi: { metadata: { ...roiEvaluation().metadata, sampleSize: 5 } } });
  const finding = presentation.findings.find((f) => f.id === "sample-size-insufficient");
  assert.ok(finding);
  assert.equal(finding?.severity, "watch");
});

test("Presentationは想定外の最上位キーを持たない（domain entityの混入検知）", () => {
  const presentation = buildPresentation();
  assert.deepEqual(new Set(Object.keys(presentation)), ALLOWED_TOP_LEVEL_KEYS);
});

test("Presentationはシリアライズ可能である", () => {
  const presentation = buildPresentation();
  assert.ok(isJsonSerializable(presentation));
});

test("同じ入力なら同じPresentation JSONになる（決定的）", () => {
  assert.ok(isDeterministic(() => buildPresentation()));
});

test("nextActionsは常に購入推奨ではない旨を含む", () => {
  const presentation = buildPresentation();
  assert.ok(presentation.nextActions.some((a) => a.includes("購入推奨")));
});
