import type { ForwardTestResult, ResearchRule, RuleStatus } from "./researchRule";
import { validateEvaluationMetadata } from "./researchEvaluation";
import { determineEvaluationScope } from "./researchRuleConditions";

const STATUS_ORDER: RuleStatus[] = ["candidate", "backtest", "forward", "review", "approved", "production"];
const VALID_RULE_STATUSES: readonly RuleStatus[] = [
  "candidate",
  "backtest",
  "forward",
  "review",
  "approved",
  "production",
  "deprecated",
  "archived",
];

/**
 * Production は forward n>=200 の候補を格上げ基準にした CLAUDE.md の現行運用に合わせた暫定値。
 * ルールごとに閾値を変える必要が出てきたら validateProductionEligibility に引数を追加する。
 */
export const MIN_PRODUCTION_SAMPLE_SIZE = 200;
export const MIN_PRODUCTION_CONFIDENCE = 0.8;

function isRuleStatus(value: unknown): value is RuleStatus {
  return typeof value === "string" && VALID_RULE_STATUSES.includes(value as RuleStatus);
}

export function canTransitionRuleStatus(from: RuleStatus, to: RuleStatus): boolean {
  // Persisted JSON and programmatic callers can bypass the TypeScript union at runtime.
  // Fail closed before applying the special deprecated/archive transition rules.
  if (!isRuleStatus(from) || !isRuleStatus(to)) return false;
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

function requireFiniteMetric(
  reasons: string[],
  name: "hitRate" | "roi" | "maxDrawdown",
  value: unknown,
  options: { min: number; max?: number },
): void {
  if (typeof value !== "number"
    || !Number.isFinite(value)
    || value < options.min
    || (options.max !== undefined && value > options.max)) {
    const range = options.max === undefined ? `>= ${options.min}` : `${options.min}..${options.max}`;
    reasons.push(`${name} ${String(value)} is invalid; expected a finite value in ${range}`);
  }
}

export function validateProductionEligibility(
  rule: ResearchRule,
  evaluation: ForwardTestResult,
): ProductionEligibility {
  const reasons: string[] = [];

  if (rule.status !== "approved") {
    reasons.push(`rule status is "${rule.status}", must be "approved" before production`);
  }
  if (determineEvaluationScope(rule.evaluationConditions) === "invalid-condition-fallback") {
    reasons.push(
      "rule evaluationConditions are invalid; production eligibility cannot use shared fallback for a condition-bearing rule",
    );
  }
  if (typeof evaluation.ruleId !== "string" || evaluation.ruleId !== rule.ruleId) {
    reasons.push(`evaluation ruleId "${String(evaluation.ruleId)}" does not match rule "${rule.ruleId}"`);
  }
  if (evaluation.isForwardTested !== true) {
    reasons.push("evaluation has not passed forward test");
  }

  const metadata = evaluation.metadata;
  if (metadata === null || typeof metadata !== "object") {
    reasons.push("evaluation metadata is missing or invalid");
  } else {
    const metadataValidation = validateEvaluationMetadata(metadata);
    for (const warning of metadataValidation.warnings) {
      reasons.push(`evaluation metadata invalid: ${warning}`);
    }
  }

  const sampleSize = evaluation.metadata?.sampleSize;
  if (!Number.isSafeInteger(sampleSize) || sampleSize < MIN_PRODUCTION_SAMPLE_SIZE) {
    reasons.push(`sample size ${String(sampleSize)} is invalid or below minimum ${MIN_PRODUCTION_SAMPLE_SIZE}`);
  }

  const confidence = evaluation.confidence;
  if (typeof confidence !== "number"
    || !Number.isFinite(confidence)
    || confidence < MIN_PRODUCTION_CONFIDENCE
    || confidence > 1) {
    reasons.push(`confidence ${String(confidence)} is invalid or below minimum ${MIN_PRODUCTION_CONFIDENCE}`);
  }

  requireFiniteMetric(reasons, "hitRate", evaluation.hitRate, { min: 0, max: 1 });
  requireFiniteMetric(reasons, "roi", evaluation.roi, { min: 0 });
  requireFiniteMetric(reasons, "maxDrawdown", evaluation.maxDrawdown, { min: 0 });

  return { eligible: reasons.length === 0, reasons };
}
