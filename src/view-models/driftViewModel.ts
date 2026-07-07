import type { DriftSeverity } from "../domain/researchDrift";
import type { RuleStatus } from "../domain/researchRule";

/**
 * Drift Detection（Phase 4）の表示契約。researchViewModel.ts と同じ位置づけで、
 * DriftDetectionResult（src/domain/researchDrift.ts）を表示用に整形するだけの型群。
 * severity/signals/warningsの判定ロジックはすべてsrc/domain側の結果をそのまま使い、
 * ここでは再計算・再判定を一切行わない。
 */

export type DriftSignalViewModel = {
  id: string;
  severity: DriftSeverity;
  message: string;
};

export type DriftDetectionViewModel = {
  ruleId: string;
  /** data/research-rules.json に登録があれば付与する。無ければnull（adhoc rule）。 */
  ruleTitle: string | null;
  /** 同上。statusが"production"以外の場合、呼び出し側はこれを見て「production drift」と断定してはいけない。 */
  ruleStatus: RuleStatus | null;
  severity: DriftSeverity;
  baselineRoi: number;
  recentRoi: number;
  roiDelta: number;
  baselineSampleSize: number;
  recentSampleSize: number;
  signals: DriftSignalViewModel[];
  warnings: string[];
  reasonSummary: string;
  evaluatedAt: string;
};

/** 複数Driftの一覧表示用（Phase 5 Daily Report接続前提の下地）。 */
export type DriftSummaryViewModel = {
  generatedAt: string;
  drifts: DriftDetectionViewModel[];
  totalCritical: number;
};
