import type { DriftDetectionResult } from "../domain/researchDrift";
import type { ResearchRule } from "../domain/researchRule";
import type { DriftDetectionViewModel, DriftSignalViewModel, DriftSummaryViewModel } from "./driftViewModel";

/**
 * DriftDetectionResult（src/domain/researchDrift.ts）を、Fable/Reactどちらでも
 * そのまま描画できるViewModelへ変換するアダプタ群。ここでROI/severity/signalsを
 * 計算し直すことはしない（src/domainの結果をそのまま使う）。
 *
 * ruleMeta（title/status）は data/research-rules.json 由来の付随情報であり、
 * ドリフト判定そのものには使わない（表示ラベルとstatus注記の付与のみ）。
 */

function buildSignalViewModels(signals: DriftDetectionResult["signals"]): DriftSignalViewModel[] {
  return signals.map((signal) => ({ id: signal.id, severity: signal.severity, message: signal.message }));
}

/** 表示用の要約文字列を組み立てるだけで、severityやroiDeltaの判定はしない。 */
function buildReasonSummary(result: DriftDetectionResult, ruleMeta?: Pick<ResearchRule, "title" | "status">): string {
  const roiDeltaPt = (result.roiDelta * 100).toFixed(1);
  const baselinePct = (result.baselineRoi * 100).toFixed(1);
  const recentPct = (result.recentRoi * 100).toFixed(1);
  const label = ruleMeta?.title ?? result.ruleId;
  const statusNote = ruleMeta?.status ? ` [status=${ruleMeta.status}]` : "";
  return `${label}${statusNote}: severity=${result.severity}, roi ${baselinePct}% -> ${recentPct}% (${roiDeltaPt}pt)`;
}

/**
 * ruleMeta.status が "production" 以外の場合、この drift を production 崩壊と
 * 断定しないよう明示する注記を1件追加するだけの表示ヘルパー。ruleMetaが無い
 * （adhoc rule）場合は何も追加しない。
 */
function buildWarnings(result: DriftDetectionResult, ruleMeta?: Pick<ResearchRule, "title" | "status">): string[] {
  const warnings = [...result.warnings];
  if (ruleMeta?.status && ruleMeta.status !== "production") {
    warnings.push(
      `ruleId "${result.ruleId}" registry status is "${ruleMeta.status}", not "production"; do not treat this drift as a confirmed production incident`,
    );
  }
  return warnings;
}

export function buildDriftDetectionViewModel(
  result: DriftDetectionResult,
  ruleMeta?: Pick<ResearchRule, "title" | "status">,
): DriftDetectionViewModel {
  return {
    ruleId: result.ruleId,
    ruleTitle: ruleMeta?.title ?? null,
    ruleStatus: ruleMeta?.status ?? null,
    severity: result.severity,
    baselineRoi: result.baselineRoi,
    recentRoi: result.recentRoi,
    roiDelta: result.roiDelta,
    baselineSampleSize: result.baselineSampleSize,
    recentSampleSize: result.recentSampleSize,
    signals: buildSignalViewModels(result.signals),
    warnings: buildWarnings(result, ruleMeta),
    reasonSummary: buildReasonSummary(result, ruleMeta),
    evaluatedAt: result.evaluatedAt,
  };
}

export function buildDriftSummaryViewModel(
  drifts: DriftDetectionViewModel[],
  generatedAt: string = new Date().toISOString(),
): DriftSummaryViewModel {
  return {
    generatedAt,
    drifts,
    totalCritical: drifts.filter((drift) => drift.severity === "critical").length,
  };
}
