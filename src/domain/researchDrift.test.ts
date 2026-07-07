import assert from "node:assert/strict";
import test from "node:test";
import { buildDriftDetectionResult, compareEvaluationWindows, detectRoiDrift, MIN_DRIFT_SAMPLE_SIZE } from "./researchDrift";
import type { RuleEvaluationResult } from "./researchRule";

function evaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "rule-1",
    metadata: {
      dataWindowStart: "2025-01-01",
      dataWindowEnd: "2025-12-31",
      evaluationRunAt: "2026-01-01T00:00:00Z",
      sampleSize: 500,
    },
    hitRate: 0.3,
    roi: 1.2,
    confidence: 0.9,
    maxDrawdown: 0.1,
    isForwardTested: false,
    isProductionEligible: false,
    reasonSummary: "baseline",
    warnings: [],
    ...overrides,
  };
}

test("recent sampleSizeが0ならseverity=unknown", () => {
  const baseline = evaluation({ roi: 1.2 });
  const recent = evaluation({
    roi: 0,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 0 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.equal(result.severity, "unknown");
  assert.equal(result.signals[0].id, "recentSampleMissing");
});

test("recent sampleSizeが最小未満ならseverity=warning", () => {
  const baseline = evaluation({ roi: 1.2 });
  const recent = evaluation({
    roi: 0.5,
    metadata: {
      dataWindowStart: "2026-01-01",
      dataWindowEnd: "2026-07-06",
      evaluationRunAt: "2026-07-06T00:00:00Z",
      sampleSize: MIN_DRIFT_SAMPLE_SIZE - 1,
    },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.equal(result.severity, "warning");
  assert.equal(result.signals[0].id, "recentSampleTooSmall");
});

test("recentRoiが大きく悪化したらcritical", () => {
  const baseline = evaluation({ roi: 1.3 });
  const recent = evaluation({
    roi: 0.9,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 200 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.equal(result.severity, "critical");
  assert.ok(result.signals.some((s) => s.id === "roiDriftCritical"));
});

test("recentRoiが少し悪化ならwarning/watch", () => {
  const baseline = evaluation({ roi: 1.2 });
  const recentWatch = evaluation({
    roi: 1.14,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 200 },
  });
  const watchResult = buildDriftDetectionResult("rule-1", baseline, recentWatch, "2026-07-06T00:00:00Z");
  assert.equal(watchResult.severity, "watch");

  const recentWarning = evaluation({
    roi: 1.0,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 200 },
  });
  const warningResult = buildDriftDetectionResult("rule-1", baseline, recentWarning, "2026-07-06T00:00:00Z");
  assert.equal(warningResult.severity, "warning");
});

test("baseline/recentとも十分で悪化なしならnone", () => {
  const baseline = evaluation({ roi: 1.2, hitRate: 0.3 });
  const recent = evaluation({
    roi: 1.25,
    hitRate: 0.31,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 300 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.equal(result.severity, "none");
  assert.deepEqual(result.signals, []);
});

test("baselineが黒字でrecentが赤字なら崩壊候補(roiCollapse)としてcritical", () => {
  const baseline = evaluation({ roi: 1.1 });
  const recent = evaluation({
    roi: 0.98,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 300 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.ok(result.signals.some((s) => s.id === "roiCollapse"));
  assert.equal(result.severity, "critical");
});

test("Forward未通過ルールの悪化はProduction崩壊と断定しない", () => {
  const baseline = evaluation({ roi: 1.3, isForwardTested: false });
  const recent = evaluation({
    roi: 0.9,
    isForwardTested: false,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 300 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.ok(result.warnings.some((w) => w.includes("must not be treated as a production collapse")));
  assert.ok(!result.signals.some((s) => s.message.toLowerCase().includes("production")));
});

test("Forward通過ルールの悪化はforward/production文脈のレビュー推奨をwarningsに含む", () => {
  const baseline = evaluation({ roi: 1.3, isForwardTested: true });
  const recent = evaluation({
    roi: 0.9,
    isForwardTested: true,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-07-06", evaluationRunAt: "2026-07-06T00:00:00Z", sampleSize: 300 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.ok(result.warnings.some((w) => w.includes("forward-tested") && w.includes("reviewed")));
});

test("compareEvaluationWindowsは判定ロジックを含まない素のdelta計算のみ行う", () => {
  const baseline = evaluation({ roi: 1.0, hitRate: 0.2 });
  const recent = evaluation({ roi: 0.8, hitRate: 0.15 });
  const comparison = compareEvaluationWindows(baseline, recent);
  assert.ok(Math.abs(comparison.roiDelta - -0.2) < 1e-9);
  assert.ok(Math.abs(comparison.hitRateDelta - -0.05) < 1e-9);
  assert.equal(comparison.baselineSampleSize, baseline.metadata.sampleSize);
  assert.equal(comparison.recentSampleSize, recent.metadata.sampleSize);
});

test("detectRoiDriftは単独でも同じseverityを返す（buildDriftDetectionResultとの整合性）", () => {
  const baseline = evaluation({ roi: 1.2 });
  const recent = evaluation({ roi: 0.9, metadata: { ...evaluation().metadata, sampleSize: 200 } });
  const comparison = compareEvaluationWindows(baseline, recent);
  const signals = detectRoiDrift(comparison);
  assert.ok(signals.some((s) => s.severity === "critical"));
});

test("recentWindowがbaselineWindowより前から始まる場合はoverlap警告を出す", () => {
  const baseline = evaluation({
    roi: 1.1,
    metadata: { dataWindowStart: "2026-01-01", dataWindowEnd: "2026-06-01", evaluationRunAt: "2026-06-02T00:00:00Z", sampleSize: 300 },
  });
  const recent = evaluation({
    roi: 1.15,
    metadata: { dataWindowStart: "2026-03-01", dataWindowEnd: "2026-08-01", evaluationRunAt: "2026-08-02T00:00:00Z", sampleSize: 300 },
  });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-08-02T00:00:00Z");
  assert.ok(result.warnings.some((w) => w.includes("overlap")));
});

test("baseline/recentのwarningsは結果にすべて引き継がれる", () => {
  const baseline = evaluation({ warnings: ["baseline warning"] });
  const recent = evaluation({ warnings: ["recent warning"], metadata: { ...evaluation().metadata, sampleSize: 300 } });
  const result = buildDriftDetectionResult("rule-1", baseline, recent, "2026-07-06T00:00:00Z");
  assert.ok(result.warnings.includes("baseline warning"));
  assert.ok(result.warnings.includes("recent warning"));
});
