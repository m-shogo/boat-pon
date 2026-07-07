import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyResearchReport } from "./dailyResearchReport";
import { MIN_PRODUCTION_SAMPLE_SIZE } from "./researchRuleLifecycle";
import type { DriftDetectionResult } from "./researchDrift";
import type { RuleEvaluationResult } from "./researchRule";

function roiEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "rule-1",
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
    ruleId: "rule-1",
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

function build(overrides: { roi?: Partial<RuleEvaluationResult>; drift?: Partial<DriftDetectionResult> } = {}) {
  return buildDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    roiEvaluation: roiEvaluation(overrides.roi),
    driftResult: driftResult(overrides.drift),
  });
}

test("reportDate/generatedAtが入る", () => {
  const report = build();
  assert.equal(report.metadata.reportDate, "2026-07-06");
  assert.equal(report.metadata.generatedAt, "2026-07-06T00:00:00.000Z");
});

test("roiSummaryにROI Explorer結果の数値がそのまま反映される（再計算しない）", () => {
  const roi = roiEvaluation({ roi: 1.234, hitRate: 0.321, confidence: 0.777 });
  const report = buildDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    roiEvaluation: roi,
    driftResult: driftResult(),
  });
  assert.equal(report.roiSummary.roi, 1.234);
  assert.equal(report.roiSummary.hitRate, 0.321);
  assert.equal(report.roiSummary.confidence, 0.777);
  assert.equal(report.roiSummary.ruleId, roi.ruleId);
});

test("driftSummaryにDrift Detection結果がそのまま反映される（再判定しない）", () => {
  const drift = driftResult({ severity: "critical", roiDelta: -0.4 });
  const report = buildDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    roiEvaluation: roiEvaluation(),
    driftResult: drift,
  });
  assert.equal(report.driftSummary.severity, "critical");
  assert.equal(report.driftSummary.roiDelta, -0.4);
  assert.equal(report.driftSummary.hasDrift, true);
});

test("severity=noneならhasDriftはfalse", () => {
  const report = build({ drift: { severity: "none" } });
  assert.equal(report.driftSummary.hasDrift, false);
});

test("元のROI/Drift warningsが消えない（idを付けて全件保持）", () => {
  const report = build({
    roi: { warnings: ["roi warning A"] },
    drift: { warnings: ["drift warning B"] },
  });
  const messages = report.warnings.map((w) => w.message);
  assert.ok(messages.includes("roi warning A"));
  assert.ok(messages.includes("drift warning B"));
});

test("Forward未通過なら必ずwarning相当のfindingが残り、買い推奨の文言を含まない", () => {
  const report = build({ roi: { isForwardTested: false } });
  const forwardFinding = report.findings.find((f) => f.id === "forward-test-not-passed");
  assert.ok(forwardFinding, "expected a forward-test-not-passed finding");
  assert.equal(forwardFinding?.severity, "watch");
  for (const text of [forwardFinding?.detail, ...report.nextActions]) {
    assert.ok(!text?.includes("買い推奨"));
    assert.ok(!text?.includes("採用確定"));
  }
});

test("sampleSize不足時は強い結論を出さない（findingはwatchに留まる）", () => {
  const report = build({ roi: { metadata: { ...roiEvaluation().metadata, sampleSize: 10 } } });
  const finding = report.findings.find((f) => f.id === "sample-size-insufficient");
  assert.ok(finding, "expected a sample-size-insufficient finding");
  assert.equal(finding?.severity, "watch");
  assert.ok(!finding?.detail.includes("危険"));
  assert.ok(!finding?.detail.includes("除外確定"));
});

test("Drift severity=criticalでもAI単独判断禁止の注記が残る", () => {
  const report = build({ drift: { severity: "critical" } });
  const finding = report.findings.find((f) => f.id === "drift-critical");
  assert.ok(finding);
  assert.equal(finding?.severity, "attention");
  assert.match(finding?.detail ?? "", /AI単独判断禁止/);
  const action = report.nextActions.find((a) => a.includes("AI単独では判断しない"));
  assert.ok(action, "expected a next action noting AI must not decide alone");
});

test("nextActionsは常に購入推奨ではない旨を含む", () => {
  const report = build();
  assert.ok(report.nextActions.some((a) => a.includes("購入推奨") && a.includes("Production昇格")));
});

test("dataQualityNotesはfallback/unsettled等のwarningsだけを抜き出す", () => {
  const report = build({
    roi: { warnings: ["3 BUY rows are unsettled and excluded from roi/hitRate", "unrelated note"] },
    drift: { warnings: ["recent window has some fallback data"] },
  });
  assert.ok(report.dataQualityNotes.some((n) => n.includes("unsettled")));
  assert.ok(report.dataQualityNotes.some((n) => n.includes("fallback")));
  assert.ok(!report.dataQualityNotes.includes("unrelated note"));
});

test("Drift判定不能（severity=unknown）はfindingで要検証扱いになる", () => {
  const report = build({ drift: { severity: "unknown" } });
  const finding = report.findings.find((f) => f.id === "drift-unknown");
  assert.ok(finding);
  assert.equal(finding?.severity, "watch");
});
