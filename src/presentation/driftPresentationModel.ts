/**
 * Drift Detection（Phase 4）用の Presentation Layer 契約。位置づけは
 * presentationModel.ts と同じ（Raw Data -> Research Engine -> Statistics
 * -> Rule Engine -> Presentation Layer -> Renderer -> React/Fable）。
 *
 * 型定義のみ。ROI/severity判定・DB/ファイルアクセスは一切含めない。
 * domain型（DriftSeverity等）を直接importせず、presentationModel.tsの
 * 他の型と同じく独立した文字列リテラルとして再定義する（renderer非依存を保つため）。
 *
 * 詳細は docs/ai/07-PRESENTATION-LAYER.md / docs/ai/10-DRIFT-OPERATIONS.md を参照。
 */

export type DriftSeverityPresentation = "none" | "watch" | "warning" | "critical" | "unknown";

/** Drift Signal 表示用の1件分。 */
export type DriftSignalPresentation = {
  id: string;
  severity: DriftSeverityPresentation;
  message: string;
};

/**
 * Drift Detection コンポーネントの契約。
 * `ruleStatus` が "production" 以外の場合、呼び出し側（renderer）はこのdriftを
 * production崩壊と断定してはいけない（`reasonSummary`/`warnings`にも同じ注記が含まれる）。
 */
export type DriftDetectionPresentation = {
  ruleId: string;
  ruleTitle: string | null;
  ruleStatus: string | null;
  severity: DriftSeverityPresentation;
  severityLabel: string;
  baselineRoi: number;
  recentRoi: number;
  roiDelta: number;
  baselineSampleSize: number;
  recentSampleSize: number;
  signals: DriftSignalPresentation[];
  warnings: string[];
  reasonSummary: string;
  evaluatedAt: string;
};

/** 複数Driftの一覧表示コンポーネントの契約（Phase 5 Daily Report接続用の下地）。 */
export type DriftSummaryPresentation = {
  generatedAt: string;
  drifts: DriftDetectionPresentation[];
  totalCritical: number;
};
