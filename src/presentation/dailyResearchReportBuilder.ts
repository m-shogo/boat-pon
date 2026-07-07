import type { DailyResearchReport, DailyResearchReportAggregate, DailyResearchRoiSummary, DailyResearchRuleReport } from "../domain/dailyResearchReport";
import type { DriftDetectionViewModel } from "../view-models/driftViewModel";
import { buildDriftPresentation } from "./driftPresentationBuilder";
import type {
  DailyResearchReportAggregatePresentation,
  DailyResearchReportPresentation,
  DailyResearchRoiPresentation,
  DailyResearchRulePresentation,
} from "./dailyResearchReportPresentation";

/**
 * DailyResearchReport（src/domain）を Presentation（renderer非依存の最終契約）へ
 * 再整形するだけの層。ROI/severity計算・所見の判断はすべて src/domain 側で
 * 済んでおり、ここでは計算をやり直さない（純粋関数のみ）。
 *
 * driftSummaryは既存の buildDriftPresentation（Phase 4.1）をそのまま再利用する。
 * ここで新しくseverityLabel等を作り直すことはしない。
 */

function buildRoiPresentation(summary: DailyResearchRoiSummary): DailyResearchRoiPresentation {
  return {
    ruleId: summary.ruleId,
    dataWindowStart: summary.dataWindowStart,
    dataWindowEnd: summary.dataWindowEnd,
    roi: summary.roi,
    hitRate: summary.hitRate,
    sampleSize: summary.sampleSize,
    confidence: summary.confidence,
    isForwardTested: summary.isForwardTested,
    isProductionEligible: summary.isProductionEligible,
    reasonSummary: summary.reasonSummary,
  };
}

/**
 * @param report DailyResearchReport（src/domain/dailyResearchReport.ts）
 * @param driftView report.driftSummary の元になった DriftDetectionResult から作った
 *   DriftDetectionViewModel（src/view-models/driftViewModel.adapters.ts）。
 *   既存のDrift Presentationと同じ形をそのまま再利用するために必要。
 */
export function buildDailyResearchReportPresentation(
  report: DailyResearchReport,
  driftView: DriftDetectionViewModel,
): DailyResearchReportPresentation {
  return {
    reportDate: report.metadata.reportDate,
    generatedAt: report.metadata.generatedAt,
    roiSummary: buildRoiPresentation(report.roiSummary),
    driftSummary: buildDriftPresentation(driftView),
    findings: report.findings.map((finding) => ({ ...finding })),
    warnings: report.warnings.map((warning) => ({ ...warning })),
    nextActions: [...report.nextActions],
    dataQualityNotes: [...report.dataQualityNotes],
  };
}

/**
 * 複数ルール向け（Phase 5.1）。1ルール分の DailyResearchRuleReport を Presentation へ
 * 再整形するだけ。既存の buildDriftPresentation をそのまま再利用する。
 *
 * @param driftView ruleReport.driftSummary の元になった DriftDetectionResult から作った
 *   DriftDetectionViewModel（ruleId/title/statusでラベル付け済みのもの）。
 */
export function buildDailyResearchRulePresentation(
  ruleReport: DailyResearchRuleReport,
  driftView: DriftDetectionViewModel,
): DailyResearchRulePresentation {
  return {
    ruleId: ruleReport.ruleId,
    title: ruleReport.title,
    status: ruleReport.status,
    roiSummary: buildRoiPresentation(ruleReport.roiSummary),
    driftSummary: buildDriftPresentation(driftView),
    warnings: ruleReport.warnings.map((warning) => ({ ...warning })),
    findings: ruleReport.findings.map((finding) => ({ ...finding })),
    nextActions: [...ruleReport.nextActions],
    isProductionEligible: ruleReport.isProductionEligible,
    isForwardTested: ruleReport.isForwardTested,
    isRuleSpecificEvaluation: ruleReport.isRuleSpecificEvaluation,
    evaluationScope: ruleReport.evaluationScope,
    conditionSummary: [...ruleReport.conditionSummary],
    conditionWarnings: [...ruleReport.conditionWarnings],
  };
}

/**
 * 複数ルール向け（Phase 5.1）。DailyResearchReportAggregate を Presentation へ
 * 再整形するだけ。件数集計（summary）は再計算せず、domain側の値をそのまま使う。
 *
 * @param driftViews ruleReports と同じ順序で対応する DriftDetectionViewModel の配列
 *   （各ルールのdriftSummaryをそのままDriftDetectionPresentationへ変換するために必要）。
 */
export function buildDailyResearchReportAggregatePresentation(
  aggregate: DailyResearchReportAggregate,
  driftViews: DriftDetectionViewModel[],
): DailyResearchReportAggregatePresentation {
  return {
    reportDate: aggregate.metadata.reportDate,
    generatedAt: aggregate.metadata.generatedAt,
    rules: aggregate.ruleReports.map((ruleReport, index) => buildDailyResearchRulePresentation(ruleReport, driftViews[index])),
    summary: { ...aggregate.summary },
    overallNextActions: [...aggregate.overallNextActions],
  };
}
