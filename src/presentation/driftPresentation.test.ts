import assert from "node:assert/strict";
import test from "node:test";
import { buildDriftPresentation, buildDriftSummaryPresentation } from "./driftPresentationBuilder";
import { isDeterministic, isJsonSerializable } from "./presentationValidation";
import { buildDriftDetectionViewModel, buildDriftSummaryViewModel } from "../view-models/driftViewModel.adapters";
import type { DriftDetectionResult } from "../domain/researchDrift";

// 全て固定値のフィクスチャ。Date.now()等は使わず、スナップショットが実行のたびに変わらないようにする。

function driftResult(overrides: Partial<DriftDetectionResult> = {}): DriftDetectionResult {
  return {
    ruleId: "wind24-exh1-switch",
    baselineWindow: { dataWindowStart: "2025-01-01", dataWindowEnd: "2025-12-31", sampleSize: 200 },
    recentWindow: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-06-01", sampleSize: 167 },
    baselineRoi: 1.05,
    recentRoi: 0.92,
    roiDelta: -0.13,
    baselineHitRate: 0.22,
    recentHitRate: 0.18,
    hitRateDelta: -0.04,
    baselineSampleSize: 200,
    recentSampleSize: 167,
    severity: "warning",
    signals: [{ id: "roiDriftWarning", severity: "warning", message: "recent roi dropped" }],
    warnings: ["forward window has 3 unsettled rows"],
    evaluatedAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
  };
}

const ALLOWED_DRIFT_KEYS = new Set([
  "ruleId", "ruleTitle", "ruleStatus", "severity", "severityLabel", "baselineRoi", "recentRoi",
  "roiDelta", "baselineSampleSize", "recentSampleSize", "signals", "warnings", "reasonSummary", "evaluatedAt",
]);

test("Drift Detection スナップショット（ruleMetaなし、adhoc rule）", () => {
  const view = buildDriftDetectionViewModel(driftResult());
  const presentation = buildDriftPresentation(view);

  assert.deepEqual(presentation, {
    ruleId: "wind24-exh1-switch",
    ruleTitle: null,
    ruleStatus: null,
    severity: "warning",
    severityLabel: "Warning",
    baselineRoi: 1.05,
    recentRoi: 0.92,
    roiDelta: -0.13,
    baselineSampleSize: 200,
    recentSampleSize: 167,
    signals: [{ id: "roiDriftWarning", severity: "warning", message: "recent roi dropped" }],
    warnings: ["forward window has 3 unsettled rows"],
    reasonSummary: presentation.reasonSummary,
    evaluatedAt: "2026-07-07T00:00:00.000Z",
  });
});

test("Drift Detection スナップショット（ruleMetaあり、production以外）", () => {
  const view = buildDriftDetectionViewModel(driftResult(), { title: "wind24-exh1-switch候補", status: "forward" });
  const presentation = buildDriftPresentation(view);

  assert.equal(presentation.ruleTitle, "wind24-exh1-switch候補");
  assert.equal(presentation.ruleStatus, "forward");
  assert.ok(presentation.warnings.some((w) => w.includes("do not treat this drift as a confirmed production incident")));
});

test("Presentationは想定外キーを持たない（domain entityの混入検知）", () => {
  const presentation = buildDriftPresentation(buildDriftDetectionViewModel(driftResult()));
  const keys = Object.keys(presentation);
  assert.deepEqual(new Set(keys), ALLOWED_DRIFT_KEYS);
});

test("Presentationはシリアライズ可能である", () => {
  const presentation = buildDriftPresentation(buildDriftDetectionViewModel(driftResult()));
  assert.ok(isJsonSerializable(presentation));
});

test("同じ入力なら同じPresentation JSONになる（決定的）", () => {
  assert.ok(isDeterministic(() => buildDriftPresentation(buildDriftDetectionViewModel(driftResult()))));
});

test("severityLabelは表示ラベルであり、severity自体の値は変えない", () => {
  const critical = buildDriftPresentation(buildDriftDetectionViewModel(driftResult({ severity: "critical" })));
  const none = buildDriftPresentation(buildDriftDetectionViewModel(driftResult({ severity: "none" })));
  assert.equal(critical.severity, "critical");
  assert.equal(critical.severityLabel, "Critical");
  assert.equal(none.severity, "none");
  assert.equal(none.severityLabel, "No drift");
});

test("buildDriftSummaryPresentationは複数driftをまとめ、totalCriticalを再判定しない", () => {
  const criticalView = buildDriftDetectionViewModel(driftResult({ ruleId: "rule-a", severity: "critical" }));
  const noneView = buildDriftDetectionViewModel(driftResult({ ruleId: "rule-b", severity: "none" }));
  const summaryView = buildDriftSummaryViewModel([criticalView, noneView], "2026-07-07T00:00:00.000Z");
  const summaryPresentation = buildDriftSummaryPresentation(summaryView);

  assert.equal(summaryPresentation.drifts.length, 2);
  assert.equal(summaryPresentation.totalCritical, 1);
  assert.equal(summaryPresentation.generatedAt, "2026-07-07T00:00:00.000Z");
});
