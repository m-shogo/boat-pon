import type { DriftDetectionResult, DriftSeverity } from "./researchDrift";
import type { RuleEvaluationResult } from "./researchRule";
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

function buildDailyResearchWarnings(roiWarnings: string[], driftWarnings: string[]): DailyResearchReportWarning[] {
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
