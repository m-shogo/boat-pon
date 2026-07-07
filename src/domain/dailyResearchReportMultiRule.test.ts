import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyResearchRuleReport, buildMultiRuleDailyResearchReport } from "./dailyResearchReport";
import { MIN_PRODUCTION_SAMPLE_SIZE } from "./researchRuleLifecycle";
import type { DriftDetectionResult } from "./researchDrift";
import type { RuleEvaluationResult, RuleStatus } from "./researchRule";

function roiEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    ruleId: "shared-adhoc",
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
    ruleId: "shared-adhoc",
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

function ruleInput(
  ruleId: string,
  status: RuleStatus,
  overrides: { roi?: Partial<RuleEvaluationResult>; drift?: Partial<DriftDetectionResult>; title?: string } = {},
) {
  return {
    ruleId,
    title: overrides.title ?? `title-${ruleId}`,
    status,
    roiEvaluation: roiEvaluation(overrides.roi),
    driftResult: driftResult(overrides.drift),
  };
}

test("buildDailyResearchRuleReportはruleId/title/statusでラベル付けし直すだけで数値を変えない", () => {
  const report = buildDailyResearchRuleReport(ruleInput("rule-a", "forward", { roi: { roi: 1.234 } }));
  assert.equal(report.ruleId, "rule-a");
  assert.equal(report.title, "title-rule-a");
  assert.equal(report.status, "forward");
  assert.equal(report.roiSummary.ruleId, "rule-a");
  assert.equal(report.roiSummary.roi, 1.234);
  assert.equal(report.driftSummary.ruleId, "rule-a");
});

test("titleを渡さなければnullになる", () => {
  const input = ruleInput("rule-a", "candidate");
  const { title: _title, ...withoutTitle } = input;
  const report = buildDailyResearchRuleReport(withoutTitle);
  assert.equal(report.title, null);
});

test("statusを渡さなければnullになる（adhoc扱い）", () => {
  const input = ruleInput("rule-a", "candidate");
  const { status: _status, ...withoutStatus } = input;
  const report = buildDailyResearchRuleReport(withoutStatus);
  assert.equal(report.status, null);
});

test("warningsに『ルール固有の条件で絞り込んでいない』旨が必ず入る", () => {
  const report = buildDailyResearchRuleReport(ruleInput("rule-a", "forward"));
  assert.ok(report.warnings.some((w) => w.id === "not-rule-specific-filter"));
});

test("statusがproduction以外ならProduction未達findingが付く", () => {
  const report = buildDailyResearchRuleReport(ruleInput("rule-a", "forward"));
  const finding = report.findings.find((f) => f.id === "rule-status-not-production");
  assert.ok(finding);
  assert.equal(finding?.severity, "watch");
  assert.match(finding?.detail ?? "", /has not reached production/);
});

test("statusがproductionならProduction未達findingは付かない", () => {
  const report = buildDailyResearchRuleReport(ruleInput("rule-a", "production"));
  assert.ok(!report.findings.some((f) => f.id === "rule-status-not-production"));
});

test("Forward未通過ならwarning相当のfindingが残る（複数ルールでも消えない）", () => {
  const report = buildDailyResearchRuleReport(ruleInput("rule-a", "backtest", { roi: { isForwardTested: false } }));
  assert.ok(report.findings.some((f) => f.id === "forward-test-not-passed"));
});

test("archivedルールでもbuildDailyResearchRuleReport自体は動く（除外はCLI/呼び出し側の責務）", () => {
  const report = buildDailyResearchRuleReport(ruleInput("rule-archived", "archived"));
  assert.equal(report.status, "archived");
});

test("buildMultiRuleDailyResearchReportはルールごとの評価を並べるだけで、severityを再判定しない", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      ruleInput("rule-critical", "forward", { drift: { severity: "critical" } }),
      ruleInput("rule-warning", "forward", { drift: { severity: "warning" } }),
      ruleInput("rule-watch", "forward", { drift: { severity: "watch" } }),
      ruleInput("rule-unknown", "forward", { drift: { severity: "unknown" } }),
      ruleInput("rule-none", "production", { drift: { severity: "none" } }),
    ],
  });

  assert.equal(aggregate.ruleReports.length, 5);
  assert.equal(aggregate.ruleReports[0].driftSummary.severity, "critical");
  assert.equal(aggregate.summary.totalRules, 5);
});

test("critical/warning/unknown件数の集計が正しい（watchはwarning側に含む）", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      ruleInput("rule-critical-1", "forward", { drift: { severity: "critical" } }),
      ruleInput("rule-critical-2", "forward", { drift: { severity: "critical" } }),
      ruleInput("rule-warning-1", "forward", { drift: { severity: "warning" } }),
      ruleInput("rule-watch-1", "forward", { drift: { severity: "watch" } }),
      ruleInput("rule-unknown-1", "forward", { drift: { severity: "unknown" } }),
      ruleInput("rule-none-1", "production", { drift: { severity: "none" } }),
    ],
  });

  assert.equal(aggregate.summary.criticalDriftCount, 2);
  assert.equal(aggregate.summary.warningDriftCount, 2);
  assert.equal(aggregate.summary.unknownDriftCount, 1);
});

test("Forward未通過件数・非production件数の集計が正しい", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [
      ruleInput("rule-a", "candidate", { roi: { isForwardTested: false } }),
      ruleInput("rule-b", "forward", { roi: { isForwardTested: false } }),
      ruleInput("rule-c", "production", { roi: { isForwardTested: true } }),
    ],
  });

  assert.equal(aggregate.summary.forwardUntestedCount, 2);
  assert.equal(aggregate.summary.nonProductionStatusCount, 2);
});

test("overallNextActionsは常に自動採用・買い推奨ではない旨を含み、断定表現を含まない", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [ruleInput("rule-a", "forward", { drift: { severity: "critical" } })],
  });

  assert.ok(aggregate.overallNextActions.some((a) => a.includes("自動採用") && a.includes("購入推奨")));
  for (const action of aggregate.overallNextActions) {
    assert.ok(!action.includes("買い推奨"));
    assert.ok(!action.includes("採用確定"));
  }
});

test("ruleReportsが0件でも壊れない", () => {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate: "2026-07-06",
    generatedAt: "2026-07-06T00:00:00.000Z",
    rules: [],
  });
  assert.equal(aggregate.summary.totalRules, 0);
  assert.equal(aggregate.ruleReports.length, 0);
  assert.ok(aggregate.overallNextActions.length > 0);
});
