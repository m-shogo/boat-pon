import type { ForwardTestResult, ResearchRule, RuleEvaluationResult, RuleStatus } from "../domain/researchRule";
import { MIN_PRODUCTION_CONFIDENCE, MIN_PRODUCTION_SAMPLE_SIZE, validateProductionEligibility } from "../domain/researchRuleLifecycle";
import type {
  EvaluationMetricViewModel,
  OpportunityScoreViewModel,
  ResearchSummaryViewModel,
  RiskLevel,
  RuleCardViewModel,
  RuleLifecycleStepViewModel,
  WarningBadgeViewModel,
  WarningSeverity,
} from "./researchViewModel";

/**
 * decision_history由来のRuleEvaluationResult / ResearchRuleを、
 * Fable/Reactどちらでもそのまま描画できるViewModelへ変換するアダプタ群。
 * ここでROIやForward判定を計算し直すことはしない（src/domainの結果をそのまま使う）。
 */

/** 長い理由文字列をカード表示向けに短縮する。 */
export function summarizeReason(reasonSummary: string, maxLength = 90): string {
  if (reasonSummary.length <= maxLength) return reasonSummary;
  return `${reasonSummary.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * sampleSize不足・confidence不足はROIの高さに関係なく"high"にする
 * （高ROIでも危険なら警告する、というRisk Scoreの方針に合わせる）。
 * Forward未通過は"medium"止まり（"low"にはしない）。
 */
export function deriveRiskLevel(evaluation: RuleEvaluationResult): RiskLevel {
  if (evaluation.metadata.sampleSize <= 0) return "unknown";
  if (evaluation.metadata.sampleSize < MIN_PRODUCTION_SAMPLE_SIZE || evaluation.confidence < MIN_PRODUCTION_CONFIDENCE) {
    return "high";
  }
  if (!evaluation.isForwardTested) return "medium";
  return "low";
}

function starsFromRoi(roi: number): number {
  if (roi >= 1.3) return 5;
  if (roi >= 1.1) return 4;
  if (roi >= 1.0) return 3;
  if (roi >= 0.9) return 2;
  if (roi >= 0.7) return 1;
  return 0;
}

function starLabel(score: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(score)));
  return "★".repeat(clamped) + "☆".repeat(5 - clamped);
}

export function buildOpportunityScoreViewModel(evaluation: RuleEvaluationResult): OpportunityScoreViewModel {
  const riskLevel = deriveRiskLevel(evaluation);
  const rawStars = starsFromRoi(evaluation.roi);
  // riskが high/unknown なら、ROIがどれだけ高く見えても星は2個までに抑える。
  const score = riskLevel === "high" || riskLevel === "unknown" ? Math.min(rawStars, 2) : rawStars;
  return {
    score,
    scoreLabel: starLabel(score),
    riskLevel,
    reasonSummary: summarizeReason(evaluation.reasonSummary),
  };
}

function classifySeverity(message: string): WarningSeverity {
  const lower = message.toLowerCase();
  if (lower.includes("future leak")) return "critical";
  if (lower.includes("fallback") || lower.includes("lack payout_yen") || lower.includes("unsettled") || lower.includes("missing")) {
    return "warning";
  }
  return "info";
}

export function buildWarningBadges(evaluation: RuleEvaluationResult): WarningBadgeViewModel[] {
  const badges: WarningBadgeViewModel[] = [];

  if (evaluation.metadata.sampleSize < MIN_PRODUCTION_SAMPLE_SIZE) {
    badges.push({
      id: "sample-size",
      label: "Sample size",
      severity: "warning",
      message: `sample size ${evaluation.metadata.sampleSize} is below the production minimum ${MIN_PRODUCTION_SAMPLE_SIZE}`,
    });
  }
  if (evaluation.confidence < MIN_PRODUCTION_CONFIDENCE) {
    badges.push({
      id: "confidence",
      label: "Confidence",
      severity: "warning",
      message: `confidence ${evaluation.confidence.toFixed(3)} is below the production minimum ${MIN_PRODUCTION_CONFIDENCE}`,
    });
  }
  if (!evaluation.isForwardTested) {
    badges.push({
      id: "forward-test",
      label: "Forward test",
      severity: "critical",
      message: "not forward-tested yet; do not treat as production-ready regardless of ROI",
    });
  }

  evaluation.warnings.forEach((message, index) => {
    badges.push({ id: `source-${index}`, label: "Note", severity: classifySeverity(message), message });
  });

  return badges;
}

const LIFECYCLE_STEPS: Array<{ id: RuleStatus; label: string }> = [
  { id: "candidate", label: "Candidate" },
  { id: "backtest", label: "Backtest" },
  { id: "forward", label: "Forward Test" },
  { id: "review", label: "Review" },
  { id: "approved", label: "Approved" },
  { id: "production", label: "Production" },
];

/**
 * ResearchRuleは現状の状態しか持たない（履歴を持たない）ため、
 * deprecated/archivedは「どこまで進んだか不明」として全ステップ未完了で返す。
 */
export function buildLifecycleStepViewModel(rule: ResearchRule): RuleLifecycleStepViewModel[] {
  const currentIndex = LIFECYCLE_STEPS.findIndex((step) => step.id === rule.status);
  return LIFECYCLE_STEPS.map((step, index) => ({
    id: step.id,
    label: step.label,
    isCompleted: currentIndex >= 0 && index < currentIndex,
    isCurrent: index === currentIndex,
  }));
}

function buildEvaluationMetrics(evaluation: RuleEvaluationResult): EvaluationMetricViewModel[] {
  return [
    { id: "roi", label: "ROI", value: evaluation.roi, displayValue: `${(evaluation.roi * 100).toFixed(1)}%` },
    { id: "hitRate", label: "Hit rate", value: evaluation.hitRate, displayValue: `${(evaluation.hitRate * 100).toFixed(1)}%` },
    {
      id: "sampleSize",
      label: "Sample size",
      value: evaluation.metadata.sampleSize,
      displayValue: String(evaluation.metadata.sampleSize),
    },
    { id: "confidence", label: "Confidence", value: evaluation.confidence, displayValue: evaluation.confidence.toFixed(3) },
    {
      id: "maxDrawdown",
      label: "Max drawdown",
      value: evaluation.maxDrawdown,
      displayValue: `${(evaluation.maxDrawdown * 100).toFixed(1)}%`,
    },
  ];
}

/** isForwardTested=falseなら、rule.statusやeligibility計算に関わらず必ずfalseを返す。 */
function computeProductionEligible(rule: ResearchRule, evaluation: RuleEvaluationResult): boolean {
  if (!evaluation.isForwardTested) return false;
  return validateProductionEligibility(rule, evaluation as ForwardTestResult).eligible;
}

export function buildRuleCardViewModel(
  rule: ResearchRule,
  evaluation: RuleEvaluationResult,
  options: { title?: string } = {},
): RuleCardViewModel {
  const opportunityScore = buildOpportunityScoreViewModel(evaluation);

  return {
    id: rule.ruleId,
    title: options.title ?? rule.ruleId,
    status: rule.status,
    scoreLabel: opportunityScore.scoreLabel,
    roi: evaluation.roi,
    hitRate: evaluation.hitRate,
    sampleSize: evaluation.metadata.sampleSize,
    confidence: evaluation.confidence,
    riskLevel: opportunityScore.riskLevel,
    warnings: buildWarningBadges(evaluation),
    reasonSummary: summarizeReason(evaluation.reasonSummary),
    lifecycleSteps: buildLifecycleStepViewModel(rule),
    metrics: buildEvaluationMetrics(evaluation),
    opportunityScore,
    isForwardTested: evaluation.isForwardTested,
    isProductionEligible: computeProductionEligible(rule, evaluation),
    updatedAt: rule.updatedAt,
  };
}

export function buildResearchSummaryViewModel(
  ruleCards: RuleCardViewModel[],
  generatedAt: string = new Date().toISOString(),
): ResearchSummaryViewModel {
  return {
    generatedAt,
    ruleCards,
    totalWarnings: ruleCards.reduce((sum, card) => sum + card.warnings.length, 0),
  };
}
