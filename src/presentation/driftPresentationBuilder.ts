import type { DriftDetectionViewModel, DriftSummaryViewModel } from "../view-models/driftViewModel";
import type { DriftDetectionPresentation, DriftSeverityPresentation, DriftSummaryPresentation } from "./driftPresentationModel";

/**
 * DriftDetectionViewModel（src/view-models）を Presentation（renderer非依存の
 * 最終契約）へ再整形するだけの層。ROI/severity計算はすべて src/view-models /
 * src/domain 側で済んでおり、ここでは計算をやり直さない（純粋関数のみ）。
 */

/** severityを表示しやすいラベルへ変換するだけの静的マップ。severity自体の判定はしない。 */
const SEVERITY_LABEL: Record<DriftSeverityPresentation, string> = {
  none: "No drift",
  watch: "Watch",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown (insufficient data)",
};

export function buildDriftPresentation(view: DriftDetectionViewModel): DriftDetectionPresentation {
  return {
    ruleId: view.ruleId,
    ruleTitle: view.ruleTitle,
    ruleStatus: view.ruleStatus,
    severity: view.severity,
    severityLabel: SEVERITY_LABEL[view.severity],
    baselineRoi: view.baselineRoi,
    recentRoi: view.recentRoi,
    roiDelta: view.roiDelta,
    baselineSampleSize: view.baselineSampleSize,
    recentSampleSize: view.recentSampleSize,
    signals: view.signals.map((signal) => ({ id: signal.id, severity: signal.severity, message: signal.message })),
    warnings: view.warnings,
    reasonSummary: view.reasonSummary,
    evaluatedAt: view.evaluatedAt,
  };
}

export function buildDriftSummaryPresentation(summary: DriftSummaryViewModel): DriftSummaryPresentation {
  return {
    generatedAt: summary.generatedAt,
    drifts: summary.drifts.map(buildDriftPresentation),
    totalCritical: summary.totalCritical,
  };
}
