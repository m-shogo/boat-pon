import type { DailyResearchReport } from "../domain/dailyResearchReport";
import type { DriftDetectionViewModel } from "../view-models/driftViewModel";
import { buildDriftPresentation } from "./driftPresentationBuilder";
import type { DailyResearchReportPresentation, DailyResearchRoiPresentation } from "./dailyResearchReportPresentation";

/**
 * DailyResearchReport（src/domain）を Presentation（renderer非依存の最終契約）へ
 * 再整形するだけの層。ROI/severity計算・所見の判断はすべて src/domain 側で
 * 済んでおり、ここでは計算をやり直さない（純粋関数のみ）。
 *
 * driftSummaryは既存の buildDriftPresentation（Phase 4.1）をそのまま再利用する。
 * ここで新しくseverityLabel等を作り直すことはしない。
 */

function buildRoiPresentation(summary: DailyResearchReport["roiSummary"]): DailyResearchRoiPresentation {
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
