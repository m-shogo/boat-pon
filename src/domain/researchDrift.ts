import type { RuleEvaluationResult } from "./researchRule";

/**
 * Drift Detection の最小実装（Phase 4）。
 *
 * 既存の `src/domain/rollingDrift.ts`（decision_history行を月別に集計し、期待的中率との
 * calibration乖離で alert を出す既存レポート用ロジック）とは別軸。こちらは Phase 1〜2で
 * 導入した `RuleEvaluationResult`（baseline期間 vs recent期間の2つの評価結果）を比較する、
 * Research Foundation型に載った版。既存の `report:calibration` を置き換えるものではない。
 *
 * このファイルは純粋関数のみ。DB/ファイルアクセスは一切行わない
 * （読み込みは scripts/detect-research-drift.ts の役割）。
 */

export type DriftSeverity = "none" | "watch" | "warning" | "critical" | "unknown";

export type DriftWindow = {
  dataWindowStart: string;
  dataWindowEnd: string;
  sampleSize: number;
};

export type DriftComparison = {
  baselineWindow: DriftWindow;
  recentWindow: DriftWindow;
  baselineRoi: number;
  recentRoi: number;
  roiDelta: number;
  baselineHitRate: number;
  recentHitRate: number;
  hitRateDelta: number;
  baselineSampleSize: number;
  recentSampleSize: number;
};

export type DriftSignal = {
  id: string;
  severity: DriftSeverity;
  message: string;
};

export type DriftDetectionResult = DriftComparison & {
  ruleId: string;
  severity: DriftSeverity;
  signals: DriftSignal[];
  warnings: string[];
  evaluatedAt: string;
};

/** recent側のサンプルがこれ未満なら、ROI悪化判定そのものを信用しない。 */
export const MIN_DRIFT_SAMPLE_SIZE = 30;

/** roiDelta（recentRoi - baselineRoi）のしきい値。単位はROI比率（1.0 = 100%）。 */
export const DRIFT_ROI_DELTA_CRITICAL = -0.3;
export const DRIFT_ROI_DELTA_WARNING = -0.15;
export const DRIFT_ROI_DELTA_WATCH = -0.05;

/** ROI比率1.0 = 100%（実払戻ベースで投入額と払戻額が釣り合う損益分岐点）。 */
export const BREAKEVEN_ROI = 1.0;

const SEVERITY_RANK: Record<DriftSeverity, number> = {
  none: 0,
  unknown: 1,
  watch: 2,
  warning: 3,
  critical: 4,
};

/** baseline評価とrecent評価から、素の数値比較（判定ロジックなし）を作る。 */
export function compareEvaluationWindows(
  baseline: RuleEvaluationResult,
  recent: RuleEvaluationResult,
): DriftComparison {
  return {
    baselineWindow: {
      dataWindowStart: baseline.metadata.dataWindowStart,
      dataWindowEnd: baseline.metadata.dataWindowEnd,
      sampleSize: baseline.metadata.sampleSize,
    },
    recentWindow: {
      dataWindowStart: recent.metadata.dataWindowStart,
      dataWindowEnd: recent.metadata.dataWindowEnd,
      sampleSize: recent.metadata.sampleSize,
    },
    baselineRoi: baseline.roi,
    recentRoi: recent.roi,
    roiDelta: recent.roi - baseline.roi,
    baselineHitRate: baseline.hitRate,
    recentHitRate: recent.hitRate,
    hitRateDelta: recent.hitRate - baseline.hitRate,
    baselineSampleSize: baseline.metadata.sampleSize,
    recentSampleSize: recent.metadata.sampleSize,
  };
}

/**
 * 数値比較からdrift signalを導く。ここではまだ「Production崩壊」といった運用上の
 * 意味づけはせず、あくまでROI/サンプルサイズの事実だけを述べる
 * （運用文脈の付与は buildDriftDetectionResult 側の役割）。
 */
export function detectRoiDrift(comparison: DriftComparison): DriftSignal[] {
  const signals: DriftSignal[] = [];

  if (comparison.recentSampleSize === 0) {
    signals.push({
      id: "recentSampleMissing",
      severity: "unknown",
      message: "recent window has 0 settled sample; drift cannot be judged",
    });
    return signals;
  }
  if (comparison.recentSampleSize < MIN_DRIFT_SAMPLE_SIZE) {
    signals.push({
      id: "recentSampleTooSmall",
      severity: "warning",
      message: `recent sample size ${comparison.recentSampleSize} is below minimum ${MIN_DRIFT_SAMPLE_SIZE} for a reliable drift judgement`,
    });
    return signals;
  }

  const roiDeltaPt = (comparison.roiDelta * 100).toFixed(1);
  const baselineRoiPct = (comparison.baselineRoi * 100).toFixed(1);
  const recentRoiPct = (comparison.recentRoi * 100).toFixed(1);

  if (comparison.roiDelta <= DRIFT_ROI_DELTA_CRITICAL) {
    signals.push({
      id: "roiDriftCritical",
      severity: "critical",
      message: `recent roi ${recentRoiPct}% is ${roiDeltaPt}pt vs baseline ${baselineRoiPct}% (>= ${Math.abs(DRIFT_ROI_DELTA_CRITICAL) * 100}pt drop)`,
    });
  } else if (comparison.roiDelta <= DRIFT_ROI_DELTA_WARNING) {
    signals.push({
      id: "roiDriftWarning",
      severity: "warning",
      message: `recent roi ${recentRoiPct}% is ${roiDeltaPt}pt vs baseline ${baselineRoiPct}% (>= ${Math.abs(DRIFT_ROI_DELTA_WARNING) * 100}pt drop)`,
    });
  } else if (comparison.roiDelta <= DRIFT_ROI_DELTA_WATCH) {
    signals.push({
      id: "roiDriftWatch",
      severity: "watch",
      message: `recent roi ${recentRoiPct}% is ${roiDeltaPt}pt vs baseline ${baselineRoiPct}% (>= ${Math.abs(DRIFT_ROI_DELTA_WATCH) * 100}pt drop)`,
    });
  }

  if (comparison.baselineRoi >= BREAKEVEN_ROI && comparison.recentRoi < BREAKEVEN_ROI) {
    signals.push({
      id: "roiCollapse",
      severity: "critical",
      message: `baseline roi ${baselineRoiPct}% was at/above breakeven but recent roi ${recentRoiPct}% has fallen below breakeven (collapse candidate)`,
    });
  }

  return signals;
}

function overallDriftSeverity(signals: DriftSignal[]): DriftSeverity {
  return signals.reduce<DriftSeverity>(
    (worst, signal) => (SEVERITY_RANK[signal.severity] > SEVERITY_RANK[worst] ? signal.severity : worst),
    "none",
  );
}

/**
 * baseline/recentの評価結果からDriftDetectionResultを組み立てる。
 *
 * - 数値比較とsignal導出はcompareEvaluationWindows/detectRoiDriftに委譲する
 * - "Forward未通過のルールはProduction崩壊扱いにしない"（CLAUDE.md/00-VISION.mdのAI単独判断禁止に
 *   沿った安全装置）: recentEvaluation.isForwardTestedがfalseの場合、severityやsignalの内容は
 *   そのまま（ROI悪化の事実は変えない）だが、「production崩壊」という運用上の断定はせず、
 *   candidate/backtest段階の悪化に過ぎないことをwarningsで明示する
 */
export function buildDriftDetectionResult(
  ruleId: string,
  baselineEvaluation: RuleEvaluationResult,
  recentEvaluation: RuleEvaluationResult,
  now: string = new Date().toISOString(),
): DriftDetectionResult {
  const comparison = compareEvaluationWindows(baselineEvaluation, recentEvaluation);
  const signals = detectRoiDrift(comparison);
  const severity = overallDriftSeverity(signals);

  const warnings: string[] = [];
  if (comparison.recentWindow.dataWindowStart < comparison.baselineWindow.dataWindowEnd) {
    warnings.push(
      `recent window (${comparison.recentWindow.dataWindowStart}..) starts before baseline window ends (..${comparison.baselineWindow.dataWindowEnd}); windows overlap`,
    );
  }
  if (signals.length === 0) {
    warnings.push("no drift detected: recent sample is sufficient and roi did not degrade meaningfully vs baseline");
  } else if (severity === "critical" || severity === "warning") {
    warnings.push(
      recentEvaluation.isForwardTested
        ? `ruleId "${ruleId}" is forward-tested; this drift may reflect real forward/production-stage degradation and should be reviewed before further promotion`
        : `ruleId "${ruleId}" is not forward-tested; this drift reflects a candidate/backtest-stage decline only and must not be treated as a production collapse`,
    );
  }
  warnings.push(...baselineEvaluation.warnings, ...recentEvaluation.warnings);

  return {
    ...comparison,
    ruleId,
    severity,
    signals,
    warnings,
    evaluatedAt: now,
  };
}
