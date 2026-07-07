import assert from "node:assert/strict";
import test from "node:test";
import { buildDriftDetectionViewModel, buildDriftSummaryViewModel } from "./driftViewModel.adapters";
import type { DriftDetectionResult } from "../domain/researchDrift";
import type { ResearchRule } from "../domain/researchRule";

function driftResult(overrides: Partial<DriftDetectionResult> = {}): DriftDetectionResult {
  return {
    ruleId: "rule-1",
    baselineWindow: { dataWindowStart: "2025-01-01", dataWindowEnd: "2025-12-31", sampleSize: 200 },
    recentWindow: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-06-01", sampleSize: 50 },
    baselineRoi: 1.1,
    recentRoi: 0.7,
    roiDelta: -0.4,
    baselineHitRate: 0.25,
    recentHitRate: 0.1,
    hitRateDelta: -0.15,
    baselineSampleSize: 200,
    recentSampleSize: 50,
    severity: "critical",
    signals: [{ id: "roiDriftCritical", severity: "critical", message: "recent roi dropped hard" }],
    warnings: ["some source warning"],
    evaluatedAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
  };
}

test("DriftDetectionResultの数値をそのまま反映する（再計算しない）", () => {
  const result = driftResult();
  const view = buildDriftDetectionViewModel(result);

  assert.equal(view.ruleId, result.ruleId);
  assert.equal(view.baselineRoi, result.baselineRoi);
  assert.equal(view.recentRoi, result.recentRoi);
  assert.equal(view.roiDelta, result.roiDelta);
  assert.equal(view.baselineSampleSize, result.baselineSampleSize);
  assert.equal(view.recentSampleSize, result.recentSampleSize);
  assert.equal(view.severity, result.severity);
  assert.equal(view.evaluatedAt, result.evaluatedAt);
});

test("signalsはid/severity/messageをそのまま1:1で写す", () => {
  const result = driftResult();
  const view = buildDriftDetectionViewModel(result);

  assert.equal(view.signals.length, result.signals.length);
  assert.deepEqual(view.signals[0], result.signals[0]);
});

test("ruleMeta未指定ならruleTitle/ruleStatusはnull（adhoc rule扱い）", () => {
  const view = buildDriftDetectionViewModel(driftResult());
  assert.equal(view.ruleTitle, null);
  assert.equal(view.ruleStatus, null);
});

test("ruleMeta指定時はtitle/statusを反映し、reasonSummaryにstatusを含める", () => {
  const ruleMeta: Pick<ResearchRule, "title" | "status"> = { title: "風速2-4×展示1位", status: "forward" };
  const view = buildDriftDetectionViewModel(driftResult(), ruleMeta);

  assert.equal(view.ruleTitle, "風速2-4×展示1位");
  assert.equal(view.ruleStatus, "forward");
  assert.match(view.reasonSummary, /風速2-4×展示1位/);
  assert.match(view.reasonSummary, /status=forward/);
});

test("statusがproduction以外ならproduction崩壊と断定しない注記を追加する", () => {
  const ruleMeta: Pick<ResearchRule, "title" | "status"> = { title: "candidate rule", status: "candidate" };
  const view = buildDriftDetectionViewModel(driftResult(), ruleMeta);

  assert.ok(
    view.warnings.some((w) => w.includes("do not treat this drift as a confirmed production incident")),
    "expected a warning noting this is not a confirmed production incident",
  );
});

test("statusがproductionなら断定しない注記を追加しない", () => {
  const ruleMeta: Pick<ResearchRule, "title" | "status"> = { title: "production rule", status: "production" };
  const view = buildDriftDetectionViewModel(driftResult(), ruleMeta);

  assert.ok(!view.warnings.some((w) => w.includes("do not treat this drift as a confirmed production incident")));
});

test("元のwarningsはそのまま引き継がれる", () => {
  const result = driftResult({ warnings: ["a", "b"] });
  const view = buildDriftDetectionViewModel(result);
  assert.deepEqual(view.warnings, ["a", "b"]);
});

test("buildDriftSummaryViewModelはcritical件数を集計するだけで、severityを再判定しない", () => {
  const criticalView = buildDriftDetectionViewModel(driftResult({ severity: "critical" }));
  const noneView = buildDriftDetectionViewModel(driftResult({ severity: "none" }));
  const summary = buildDriftSummaryViewModel([criticalView, noneView], "2026-07-07T00:00:00.000Z");

  assert.equal(summary.drifts.length, 2);
  assert.equal(summary.totalCritical, 1);
  assert.equal(summary.generatedAt, "2026-07-07T00:00:00.000Z");
});
