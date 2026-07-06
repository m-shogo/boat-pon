/**
 * Presentation Layer（Fable導入前の最終段階）の表示契約。
 *
 * 位置づけ: Raw Data -> Research Engine -> Statistics -> Rule Engine
 *          -> Presentation Layer（このファイル） -> Renderer -> React（現在）/ Fable（将来）
 *
 * このファイルは型定義のみ。ロジック・計算・DB/ファイルアクセスは一切含めない。
 * ROI計算・Forward Test判定・Rule Lifecycle状態遷移は引き続き src/domain の役割、
 * それらを表示用に一段整えた src/view-models のViewModelを、さらにレンダラー非依存の
 * 最終契約として束ねたものがこのPresentation層になる。
 *
 * 詳細は docs/ai/07-PRESENTATION-LAYER.md を参照。
 */

export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type WarningSeverity = "info" | "warning" | "critical";

/** Warning Badge コンポーネントの契約。 */
export type WarningPresentation = {
  id: string;
  label: string;
  severity: WarningSeverity;
  message: string;
};

/** Lifecycle Timeline の1ステップ分。 */
export type LifecycleStepPresentation = {
  id: string;
  label: string;
  isCompleted: boolean;
  isCurrent: boolean;
};

/** Lifecycle Timeline コンポーネントの契約。 */
export type LifecyclePresentation = {
  steps: LifecycleStepPresentation[];
  currentStepId: string | null;
};

/** Metric Grid の1項目分。 */
export type MetricPresentation = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
};

/** Opportunity Card コンポーネントの契約。 */
export type OpportunityPresentation = {
  score: number;
  scoreLabel: string;
  riskLevel: RiskLevel;
  summary: string;
};

/** Rule Card コンポーネントの契約。UIが必要とする表示データを1つにまとめたもの。 */
export type RuleCardPresentation = {
  id: string;
  title: string;
  status: string;
  scoreLabel: string;
  roi: number;
  hitRate: number;
  sampleSize: number;
  confidence: number;
  riskLevel: RiskLevel;
  warnings: WarningPresentation[];
  reasonSummary: string;
  lifecycle: LifecyclePresentation;
  metrics: MetricPresentation[];
  opportunity: OpportunityPresentation;
  isForwardTested: boolean;
  isProductionEligible: boolean;
  updatedAt: string;
};

/** Research Summary / Daily Report コンポーネントの契約。 */
export type ResearchSummaryPresentation = {
  generatedAt: string;
  ruleCards: RuleCardPresentation[];
  totalWarnings: number;
};
