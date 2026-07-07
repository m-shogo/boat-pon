import type { DriftDetectionResult, DriftSeverity } from "./researchDrift";
import type { RuleEvaluationResult, RuleStatus } from "./researchRule";
import { MIN_PRODUCTION_SAMPLE_SIZE } from "./researchRuleLifecycle";

/**
 * Daily Research Report の最小実装（Phase 5）。
 *
 * Phase 1〜4.1で作った ROI Explorer（`buildRuleEvaluationResult`）と
 * Drift Detection（`buildDriftDetectionResult`）の結果を、1日1回の研究レポートに
 * 要約するための型と純粋関数群。ROI/Drift計算そのものはやり直さない
 * （ここでは既存の `RuleEvaluationResult` / `DriftDetectionResult` を受け取って
 * 要約・言い換えするだけ）。
 *
 * このファイルは純粋関数のみ。DB/ファイルアクセスは一切行わない
 * （読み込みは scripts/daily-research-report.ts の役割）。
 *
 * 重要: これは「研究レポート」であり、買い推奨・Production昇格の判断ではない。
 * AI単独でのルール採用・除外判断は行わない（docs/ai/00-VISION.mdの絶対原則）。
 */

export type DailyResearchReportMetadata = {
  reportDate: string;
  generatedAt: string;
};

/** RuleEvaluationResultの要約。ROIは再計算せず、そのまま抜き出すだけ。 */
export type DailyResearchRoiSummary = {
  ruleId: string;
  dataWindowStart: string;
  dataWindowEnd: string;
  roi: number;
  hitRate: number;
  sampleSize: number;
  confidence: number;
  isForwardTested: boolean;
  isProductionEligible: boolean;
  reasonSummary: string;
};

/** DriftDetectionResultの要約。severityは再判定せず、そのまま抜き出すだけ。 */
export type DailyResearchDriftSummary = {
  ruleId: string;
  severity: DriftSeverity;
  hasDrift: boolean;
  baselineRoi: number;
  recentRoi: number;
  roiDelta: number;
  baselineSampleSize: number;
  recentSampleSize: number;
  reasonSummary: string;
};

export type DailyResearchReportFindingSeverity = "info" | "watch" | "attention";

/** 研究レポート上の所見。買い推奨・除外判断ではなく「要検証」「見送り」等の研究用語に留める。 */
export type DailyResearchReportFinding = {
  id: string;
  title: string;
  detail: string;
  severity: DailyResearchReportFindingSeverity;
};

export type DailyResearchReportWarning = {
  id: string;
  message: string;
};

export type DailyResearchReport = {
  metadata: DailyResearchReportMetadata;
  roiSummary: DailyResearchRoiSummary;
  driftSummary: DailyResearchDriftSummary;
  findings: DailyResearchReportFinding[];
  warnings: DailyResearchReportWarning[];
  nextActions: string[];
  dataQualityNotes: string[];
};

/** ROI計算をやり直さず、RuleEvaluationResultから表示に必要な項目だけを抜き出す。 */
export function buildDailyResearchRoiSummary(evaluation: RuleEvaluationResult): DailyResearchRoiSummary {
  return {
    ruleId: evaluation.ruleId,
    dataWindowStart: evaluation.metadata.dataWindowStart,
    dataWindowEnd: evaluation.metadata.dataWindowEnd,
    roi: evaluation.roi,
    hitRate: evaluation.hitRate,
    sampleSize: evaluation.metadata.sampleSize,
    confidence: evaluation.confidence,
    isForwardTested: evaluation.isForwardTested,
    isProductionEligible: evaluation.isProductionEligible,
    reasonSummary: evaluation.reasonSummary,
  };
}

/** severity判定をやり直さず、DriftDetectionResultから表示に必要な項目だけを抜き出す。 */
export function buildDailyResearchDriftSummary(result: DriftDetectionResult): DailyResearchDriftSummary {
  return {
    ruleId: result.ruleId,
    severity: result.severity,
    hasDrift: result.severity !== "none",
    baselineRoi: result.baselineRoi,
    recentRoi: result.recentRoi,
    roiDelta: result.roiDelta,
    baselineSampleSize: result.baselineSampleSize,
    recentSampleSize: result.recentSampleSize,
    reasonSummary: result.signals.length ? result.signals.map((signal) => signal.message).join("; ") : "no drift signals",
  };
}

/**
 * ROI/Driftの要約から所見を作る。ここで新しい判定基準を作らない
 * （sampleSize不足・Forward未通過の閾値は既存の`MIN_PRODUCTION_SAMPLE_SIZE`と
 * `isForwardTested`をそのまま使う）。文言は必ず「要検証」「見送り」等の研究用語に留め、
 * 「買い」「採用」「除外確定」のような断定表現は使わない。
 */
export function buildDailyResearchFindings(
  roiSummary: DailyResearchRoiSummary,
  driftSummary: DailyResearchDriftSummary,
): DailyResearchReportFinding[] {
  const findings: DailyResearchReportFinding[] = [];

  if (!roiSummary.isForwardTested) {
    findings.push({
      id: "forward-test-not-passed",
      title: "Forward Test未通過",
      detail: `ruleId "${roiSummary.ruleId}" はForward Test未通過。このROIはcandidate/backtest段階の参考値であり、購入推奨ではない。`,
      severity: "watch",
    });
  }

  if (roiSummary.sampleSize < MIN_PRODUCTION_SAMPLE_SIZE) {
    findings.push({
      id: "sample-size-insufficient",
      title: "サンプル不足",
      detail: `sampleSize ${roiSummary.sampleSize} は最低ライン ${MIN_PRODUCTION_SAMPLE_SIZE} 未満。強い結論を出さず、要検証のまま扱う。`,
      severity: "watch",
    });
  }

  if (driftSummary.severity === "unknown") {
    findings.push({
      id: "drift-unknown",
      title: "Drift判定不能",
      detail: "recentサンプルが不足しておりDrift判定不能。要検証のまま保留する。",
      severity: "watch",
    });
  } else if (driftSummary.severity === "critical") {
    findings.push({
      id: "drift-critical",
      title: "ROI悪化シグナル（要検証）",
      detail:
        `baseline roi ${(driftSummary.baselineRoi * 100).toFixed(1)}% -> recent roi ${(driftSummary.recentRoi * 100).toFixed(1)}%。` +
        "悪化が大きいため要検証。この結果だけでルールの除外・降格を断定はしない（AI単独判断禁止）。",
      severity: "attention",
    });
  } else if (driftSummary.severity === "warning" || driftSummary.severity === "watch") {
    findings.push({
      id: "drift-watch",
      title: "軽度のROI悪化兆候",
      detail:
        `baseline roi ${(driftSummary.baselineRoi * 100).toFixed(1)}% -> recent roi ${(driftSummary.recentRoi * 100).toFixed(1)}%。` +
        "継続観察が必要な水準（要検証）。",
      severity: "watch",
    });
  } else {
    findings.push({
      id: "drift-none",
      title: "明確な悪化シグナルなし",
      detail: "現時点でDriftの明確な悪化シグナルは検出されていない（研究指標であり購入推奨ではない）。",
      severity: "info",
    });
  }

  return findings;
}

/**
 * 次にすべき研究上のアクション候補を作るだけで、購入・採用・除外の実行はしない。
 * 常に末尾へ「本レポートは購入推奨ではない」旨を明記する。
 */
export function buildDailyResearchNextActions(
  roiSummary: DailyResearchRoiSummary,
  driftSummary: DailyResearchDriftSummary,
): string[] {
  const actions: string[] = [];

  if (!roiSummary.isForwardTested) {
    actions.push("Forward Testを継続し、サンプルサイズが十分になってから再評価する（現時点はcandidate/backtest段階の候補）");
  }
  if (roiSummary.sampleSize < MIN_PRODUCTION_SAMPLE_SIZE) {
    actions.push("サンプルサイズが十分になるまで採用判断を保留する（見送り）");
  }

  if (driftSummary.severity === "critical" || driftSummary.severity === "warning") {
    actions.push("Driftの原因を人が確認し、除外/降格候補として要検討する（AI単独では判断しない）");
  } else if (driftSummary.severity === "watch") {
    actions.push("引き続き経過観察を継続する（要検証）");
  } else if (driftSummary.severity === "unknown") {
    actions.push("recentサンプルが増えるまでDrift判定を保留する");
  } else {
    actions.push("現状は明確な悪化なし。定期観察を継続する");
  }

  actions.push("このレポートはROI/Drift検証の要約であり、購入推奨・Production昇格の判断根拠にはしない");
  return actions;
}

export function buildDailyResearchWarnings(roiWarnings: string[], driftWarnings: string[]): DailyResearchReportWarning[] {
  return [
    ...roiWarnings.map((message, index) => ({ id: `roi-${index}`, message })),
    ...driftWarnings.map((message, index) => ({ id: `drift-${index}`, message })),
  ];
}

const DATA_QUALITY_KEYWORDS = ["fallback", "unsettled", "not found", "missing", "overlap"];

/** データ完全性に関わるwarningsだけを抜き出す（新しい判定は作らず、既存warningsの文言でフィルタするだけ）。 */
function buildDailyResearchDataQualityNotes(roiWarnings: string[], driftWarnings: string[]): string[] {
  return [...roiWarnings, ...driftWarnings].filter((message) =>
    DATA_QUALITY_KEYWORDS.some((keyword) => message.toLowerCase().includes(keyword)),
  );
}

export type BuildDailyResearchReportInput = {
  reportDate: string;
  generatedAt: string;
  roiEvaluation: RuleEvaluationResult;
  driftResult: DriftDetectionResult;
};

export function buildDailyResearchReport(input: BuildDailyResearchReportInput): DailyResearchReport {
  const roiSummary = buildDailyResearchRoiSummary(input.roiEvaluation);
  const driftSummary = buildDailyResearchDriftSummary(input.driftResult);

  return {
    metadata: { reportDate: input.reportDate, generatedAt: input.generatedAt },
    roiSummary,
    driftSummary,
    findings: buildDailyResearchFindings(roiSummary, driftSummary),
    warnings: buildDailyResearchWarnings(input.roiEvaluation.warnings, input.driftResult.warnings),
    nextActions: buildDailyResearchNextActions(roiSummary, driftSummary),
    dataQualityNotes: buildDailyResearchDataQualityNotes(input.roiEvaluation.warnings, input.driftResult.warnings),
  };
}

/**
 * 複数ルール向けDaily Research Report（Phase 5.1）。
 *
 * 重要な制約: `data/research-rules.json` の `ResearchRule` はまだルール固有の条件
 * （venue/風速/展示順位等の絞り込み式）を持たない（`docs/ai/09-RULE-CANDIDATE-MIGRATION.md`）。
 * そのため、ここで各ルールに紐づける `roiEvaluation`/`driftResult` は、そのルール専用に
 * 絞り込んだ評価ではなく、呼び出し側（CLI）が計算した共通のdecision_history集計を
 * ruleId/title/statusでラベル付けしただけのもの。これを隠さず、各ルールの`warnings`に
 * 「ルール固有の条件では絞り込んでいない」旨を必ず明記する（ブラックボックス禁止の原則）。
 */

/** ルールの登録statusが"production"以外なら、Production運用実績として扱わない旨のfindingを返す。 */
function buildRuleStatusFinding(status: RuleStatus | null): DailyResearchReportFinding | null {
  if (!status || status === "production") return null;
  return {
    id: "rule-status-not-production",
    title: "Production未達のルール",
    detail: `registry status is "${status}"; this rule has not reached production, so this evaluation must not be treated as a production result.`,
    severity: "watch",
  };
}

export type DailyResearchRuleReport = {
  ruleId: string;
  title: string | null;
  status: RuleStatus | null;
  roiSummary: DailyResearchRoiSummary;
  driftSummary: DailyResearchDriftSummary;
  warnings: DailyResearchReportWarning[];
  findings: DailyResearchReportFinding[];
  nextActions: string[];
  isProductionEligible: boolean;
  isForwardTested: boolean;
};

export type BuildDailyResearchRuleReportInput = {
  ruleId: string;
  title?: string;
  status?: RuleStatus;
  roiEvaluation: RuleEvaluationResult;
  driftResult: DriftDetectionResult;
};

/**
 * 1ルール分の DailyResearchRuleReport を作る。ROI/severityの計算はやり直さず、
 * 入力の `roiEvaluation`/`driftResult` を ruleId でラベル付けし直すだけ
 * （数値・severityは呼び出し側が渡した値のまま）。
 */
export function buildDailyResearchRuleReport(input: BuildDailyResearchRuleReportInput): DailyResearchRuleReport {
  const roiEvaluation: RuleEvaluationResult = { ...input.roiEvaluation, ruleId: input.ruleId };
  const driftResult: DriftDetectionResult = { ...input.driftResult, ruleId: input.ruleId };

  const roiSummary = buildDailyResearchRoiSummary(roiEvaluation);
  const driftSummary = buildDailyResearchDriftSummary(driftResult);

  const findings = buildDailyResearchFindings(roiSummary, driftSummary);
  const statusFinding = buildRuleStatusFinding(input.status ?? null);
  if (statusFinding) findings.push(statusFinding);

  const warnings = buildDailyResearchWarnings(roiEvaluation.warnings, driftResult.warnings);
  warnings.push({
    id: "not-rule-specific-filter",
    message:
      `roi/drift for ruleId "${input.ruleId}" is the shared decision_history aggregate, not filtered by this ` +
      "rule's specific hypothesis condition (research-rules.json does not store a queryable condition yet)",
  });

  return {
    ruleId: input.ruleId,
    title: input.title ?? null,
    status: input.status ?? null,
    roiSummary,
    driftSummary,
    warnings,
    findings,
    nextActions: buildDailyResearchNextActions(roiSummary, driftSummary),
    isProductionEligible: roiSummary.isProductionEligible,
    isForwardTested: roiSummary.isForwardTested,
  };
}

export type DailyResearchReportAggregateSummary = {
  totalRules: number;
  criticalDriftCount: number;
  warningDriftCount: number;
  unknownDriftCount: number;
  forwardUntestedCount: number;
  nonProductionStatusCount: number;
};

export type DailyResearchReportAggregate = {
  metadata: DailyResearchReportMetadata;
  ruleReports: DailyResearchRuleReport[];
  summary: DailyResearchReportAggregateSummary;
  overallNextActions: string[];
};

/** severity/status別の件数を数えるだけで、判定基準そのものは作らない。 */
function summarizeDailyResearchRuleReports(ruleReports: DailyResearchRuleReport[]): DailyResearchReportAggregateSummary {
  return {
    totalRules: ruleReports.length,
    criticalDriftCount: ruleReports.filter((rule) => rule.driftSummary.severity === "critical").length,
    warningDriftCount: ruleReports.filter((rule) => rule.driftSummary.severity === "warning" || rule.driftSummary.severity === "watch").length,
    unknownDriftCount: ruleReports.filter((rule) => rule.driftSummary.severity === "unknown").length,
    forwardUntestedCount: ruleReports.filter((rule) => !rule.isForwardTested).length,
    nonProductionStatusCount: ruleReports.filter((rule) => rule.status !== "production").length,
  };
}

/**
 * 全体向けの次のアクション候補を作るだけで、自動採用・買い推奨・Production昇格は行わない。
 * 文言は必ず「要検証」「見送り候補」「経過観察」等の研究用語に留める。
 */
function buildOverallNextActions(summary: DailyResearchReportAggregateSummary): string[] {
  const actions: string[] = [];

  if (summary.criticalDriftCount > 0) {
    actions.push(
      `critical drift検出ルールが${summary.criticalDriftCount}件。人が原因を確認し、除外/降格候補として要検討する（AI単独では判断しない）`,
    );
  }
  if (summary.warningDriftCount > 0) {
    actions.push(`軽度のROI悪化兆候があるルールが${summary.warningDriftCount}件。経過観察を継続する（要検証）`);
  }
  if (summary.unknownDriftCount > 0) {
    actions.push(`recentサンプル不足でDrift判定不能のルールが${summary.unknownDriftCount}件。判定を保留する`);
  }
  if (summary.forwardUntestedCount > 0) {
    actions.push(`Forward Test未通過のルールが${summary.forwardUntestedCount}件。継続してForward Testを実施する（見送り候補として扱う）`);
  }
  actions.push("このレポートは複数ルールのROI/Drift検証の要約であり、購入推奨・Production昇格・自動採用の判断根拠にはしない");

  return actions;
}

export type DailyResearchRuleInput = {
  ruleId: string;
  title?: string;
  status?: RuleStatus;
  roiEvaluation: RuleEvaluationResult;
  driftResult: DriftDetectionResult;
};

export type BuildMultiRuleDailyResearchReportInput = {
  reportDate: string;
  generatedAt: string;
  rules: DailyResearchRuleInput[];
};

/**
 * 複数ルールを1つの DailyResearchReportAggregate にまとめる。各ルールの評価は
 * `buildDailyResearchRuleReport` に委譲し、ここではルール一覧の集約・件数集計のみ行う。
 */
export function buildMultiRuleDailyResearchReport(input: BuildMultiRuleDailyResearchReportInput): DailyResearchReportAggregate {
  const ruleReports = input.rules.map((rule) => buildDailyResearchRuleReport(rule));
  const summary = summarizeDailyResearchRuleReports(ruleReports);

  return {
    metadata: { reportDate: input.reportDate, generatedAt: input.generatedAt },
    ruleReports,
    summary,
    overallNextActions: buildOverallNextActions(summary),
  };
}
