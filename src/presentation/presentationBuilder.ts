import type {
  EvaluationMetricViewModel,
  OpportunityScoreViewModel,
  ResearchSummaryViewModel,
  RuleCardViewModel,
  RuleLifecycleStepViewModel,
  WarningBadgeViewModel,
} from "../view-models/researchViewModel";
import type {
  LifecyclePresentation,
  MetricPresentation,
  OpportunityPresentation,
  ResearchSummaryPresentation,
  RuleCardPresentation,
  WarningPresentation,
} from "./presentationModel";

/**
 * ViewModel（src/view-models）を Presentation（renderer非依存の最終契約）へ
 * 再整形するだけの層。ROI/risk/score計算はすべて src/view-models 側で
 * 済んでおり、ここでは計算をやり直さない（DBアクセス・ファイルアクセス・
 * CLI引数処理も行わない、純粋関数のみ）。
 */

export function buildWarningPresentation(badges: WarningBadgeViewModel[]): WarningPresentation[] {
  return badges.map((badge) => ({
    id: badge.id,
    label: badge.label,
    severity: badge.severity,
    message: badge.message,
  }));
}

export function buildMetricPresentation(metrics: EvaluationMetricViewModel[]): MetricPresentation[] {
  return metrics.map((metric) => ({
    id: metric.id,
    label: metric.label,
    value: metric.value,
    displayValue: metric.displayValue,
  }));
}

export function buildOpportunityPresentation(opportunity: OpportunityScoreViewModel): OpportunityPresentation {
  return {
    score: opportunity.score,
    scoreLabel: opportunity.scoreLabel,
    riskLevel: opportunity.riskLevel,
    summary: opportunity.reasonSummary,
  };
}

export function buildLifecyclePresentation(steps: RuleLifecycleStepViewModel[]): LifecyclePresentation {
  const current = steps.find((step) => step.isCurrent);
  return {
    steps: steps.map((step) => ({
      id: step.id,
      label: step.label,
      isCompleted: step.isCompleted,
      isCurrent: step.isCurrent,
    })),
    currentStepId: current?.id ?? null,
  };
}

export function buildRulePresentation(card: RuleCardViewModel): RuleCardPresentation {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    scoreLabel: card.scoreLabel,
    roi: card.roi,
    hitRate: card.hitRate,
    sampleSize: card.sampleSize,
    confidence: card.confidence,
    riskLevel: card.riskLevel,
    warnings: buildWarningPresentation(card.warnings),
    reasonSummary: card.reasonSummary,
    lifecycle: buildLifecyclePresentation(card.lifecycleSteps),
    metrics: buildMetricPresentation(card.metrics),
    opportunity: buildOpportunityPresentation(card.opportunityScore),
    isForwardTested: card.isForwardTested,
    isProductionEligible: card.isProductionEligible,
    updatedAt: card.updatedAt,
  };
}

export function buildResearchPresentation(summary: ResearchSummaryViewModel): ResearchSummaryPresentation {
  return {
    generatedAt: summary.generatedAt,
    ruleCards: summary.ruleCards.map(buildRulePresentation),
    totalWarnings: summary.totalWarnings,
  };
}
