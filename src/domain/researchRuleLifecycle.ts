import type { ForwardTestResult, ResearchRule, RuleStatus } from "./researchRule";

const STATUS_ORDER: RuleStatus[] = ["candidate", "backtest", "forward", "review", "approved", "production"];

/**
 * Production は forward n>=200 の候補を格上げ基準にした CLAUDE.md の現行運用に合わせた暫定値。
 * ルールごとに閾値を変える必要が出てきたら validateProductionEligibility に引数を追加する。
 */
export const MIN_PRODUCTION_SAMPLE_SIZE = 200;
export const MIN_PRODUCTION_CONFIDENCE = 0.8;

export function canTransitionRuleStatus(from: RuleStatus, to: RuleStatus): boolean {
  if (from === to) return false;
  if (from === "archived") return false;
  if (to === "archived") return from === "deprecated";
  if (to === "deprecated") return true;

  const fromIndex = STATUS_ORDER.indexOf(from);
  const toIndex = STATUS_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

export type ProductionEligibility = {
  eligible: boolean;
  reasons: string[];
};

export function validateProductionEligibility(
  rule: ResearchRule,
  evaluation: ForwardTestResult,
): ProductionEligibility {
  const reasons: string[] = [];

  if (rule.status !== "approved") {
    reasons.push(`rule status is "${rule.status}", must be "approved" before production`);
  }
  if (!evaluation.isForwardTested) {
    reasons.push("evaluation has not passed forward test");
  }
  if (evaluation.metadata.sampleSize < MIN_PRODUCTION_SAMPLE_SIZE) {
    reasons.push(`sample size ${evaluation.metadata.sampleSize} is below minimum ${MIN_PRODUCTION_SAMPLE_SIZE}`);
  }
  if (evaluation.confidence < MIN_PRODUCTION_CONFIDENCE) {
    reasons.push(`confidence ${evaluation.confidence} is below minimum ${MIN_PRODUCTION_CONFIDENCE}`);
  }

  return { eligible: reasons.length === 0, reasons };
}
