import type { DriftDetectionPresentation } from "./driftPresentationModel";

/**
 * Daily Research Report（Phase 5）用の Presentation Layer 契約。位置づけは
 * presentationModel.ts / driftPresentationModel.ts と同じ
 * （Raw Data -> Research Engine -> Statistics -> Rule Engine -> Presentation Layer
 * -> Renderer -> React/Fable）。
 *
 * 型定義のみ。ROI/severity判定・所見の判断ロジック・DB/ファイルアクセスは一切含めない。
 * `driftSummary` は既存の `DriftDetectionPresentation`（Phase 4.1）をそのまま再利用し、
 * severityLabel等の表現を重複させない（整合性を保つため）。
 *
 * 重要: これは研究レポートの表示契約であり、買い推奨・Production昇格を表現するものではない。
 * 詳細は docs/ai/11-DAILY-RESEARCH-REPORT.md を参照。
 */

/** ROI Explorer結果の要約表示用。 */
export type DailyResearchRoiPresentation = {
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

export type DailyResearchFindingSeverityPresentation = "info" | "watch" | "attention";

/** 研究レポート上の所見表示用。買い推奨・除外確定ではなく研究用語（要検証/見送り等）に留める。 */
export type DailyResearchFindingPresentation = {
  id: string;
  title: string;
  detail: string;
  severity: DailyResearchFindingSeverityPresentation;
};

export type DailyResearchWarningPresentation = {
  id: string;
  message: string;
};

/** Daily Research Report コンポーネントの契約。 */
export type DailyResearchReportPresentation = {
  reportDate: string;
  generatedAt: string;
  roiSummary: DailyResearchRoiPresentation;
  driftSummary: DriftDetectionPresentation;
  findings: DailyResearchFindingPresentation[];
  warnings: DailyResearchWarningPresentation[];
  nextActions: string[];
  dataQualityNotes: string[];
};
