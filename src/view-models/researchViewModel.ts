import type { RuleStatus } from "../domain/researchRule";

/**
 * Fable導入前のUI/演出向け表示契約。React/Fableどちらの描画層からも同じ形で
 * 消費できることを目的にしており、ここに計算ロジックは置かない
 * （ROI/Forward判定/Production昇格判定は src/domain 側の役割のまま）。
 * 詳細は docs/ai/06-FABLE-READINESS.md を参照。
 */

export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type WarningSeverity = "info" | "warning" | "critical";

export type WarningBadgeViewModel = {
  id: string;
  label: string;
  severity: WarningSeverity;
  message: string;
};

export type RuleLifecycleStepViewModel = {
  id: RuleStatus;
  label: string;
  isCompleted: boolean;
  isCurrent: boolean;
};

export type EvaluationMetricViewModel = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
};

export type OpportunityScoreViewModel = {
  score: number;
  scoreLabel: string;
  riskLevel: RiskLevel;
  reasonSummary: string;
};

export type RuleCardViewModel = {
  id: string;
  title: string;
  status: RuleStatus;
  scoreLabel: string;
  roi: number;
  hitRate: number;
  sampleSize: number;
  confidence: number;
  riskLevel: RiskLevel;
  warnings: WarningBadgeViewModel[];
  reasonSummary: string;
  lifecycleSteps: RuleLifecycleStepViewModel[];
  metrics: EvaluationMetricViewModel[];
  opportunityScore: OpportunityScoreViewModel;
  isForwardTested: boolean;
  isProductionEligible: boolean;
  updatedAt: string;
};

export type ResearchSummaryViewModel = {
  generatedAt: string;
  ruleCards: RuleCardViewModel[];
  totalWarnings: number;
};
