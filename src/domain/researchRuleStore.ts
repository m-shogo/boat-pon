import type { ForwardTestResult, ResearchRule, RuleStatus } from "./researchRule";
import { canTransitionRuleStatus, validateProductionEligibility } from "./researchRuleLifecycle";

/**
 * Rule Lifecycle永続化の最小実装（Phase 3）。
 *
 * このファイルは純粋関数のみ。ファイルI/O・DBアクセスは一切行わない
 * （書き込み先はscripts/manage-research-rules.tsが担当する）。
 *
 * 安全装置:
 * - 新規ルールは必ず"candidate"から始まる（createResearchRule）
 * - canTransitionRuleStatus に反する遷移は拒否する（Production直行禁止を含む）
 * - "production"への遷移は、Forward Testを通過した評価（ForwardTestResult）を
 *   必須とし、validateProductionEligibilityを満たさなければ拒否する
 */

export type RuleStoreError = {
  ruleId: string;
  reason: string;
};

export type RuleStoreResult =
  | { ok: true; rules: ResearchRule[] }
  | { ok: false; error: RuleStoreError };

/** 新規ルールは常に"candidate"段階で作成する。他のstatusで直接作ることはできない。 */
export function createResearchRule(
  ruleId: string,
  reasonSummary: string,
  now: string = new Date().toISOString(),
  title?: string,
): ResearchRule {
  return {
    ruleId,
    status: "candidate",
    createdAt: now,
    updatedAt: now,
    reasonSummary,
    warnings: [],
    ...(title ? { title } : {}),
  };
}

export function findRule(rules: ResearchRule[], ruleId: string): ResearchRule | undefined {
  return rules.find((rule) => rule.ruleId === ruleId);
}

export function addRule(rules: ResearchRule[], rule: ResearchRule): RuleStoreResult {
  if (findRule(rules, rule.ruleId)) {
    return { ok: false, error: { ruleId: rule.ruleId, reason: `rule "${rule.ruleId}" already exists` } };
  }
  return { ok: true, rules: [...rules, rule] };
}

/**
 * 1件のルールの状態遷移を試みる。
 * - 未登録ruleId、canTransitionRuleStatusで許可されない遷移は拒否する
 * - "production"への遷移はevaluationを必須とし、validateProductionEligibilityを
 *   満たさなければ拒否する（Forward未通過ルールをProduction扱いしないための最終防波堤）
 */
export function applyRuleTransition(
  rules: ResearchRule[],
  ruleId: string,
  to: RuleStatus,
  evaluation?: ForwardTestResult,
  now: string = new Date().toISOString(),
): RuleStoreResult {
  const index = rules.findIndex((rule) => rule.ruleId === ruleId);
  if (index === -1) {
    return { ok: false, error: { ruleId, reason: `rule "${ruleId}" not found` } };
  }
  const rule = rules[index];

  if (!canTransitionRuleStatus(rule.status, to)) {
    return { ok: false, error: { ruleId, reason: `cannot transition from "${rule.status}" to "${to}"` } };
  }

  if (to === "production") {
    if (!evaluation) {
      return { ok: false, error: { ruleId, reason: "transition to production requires a forward-tested evaluation" } };
    }
    const eligibility = validateProductionEligibility(rule, evaluation);
    if (!eligibility.eligible) {
      return { ok: false, error: { ruleId, reason: `not production eligible: ${eligibility.reasons.join("; ")}` } };
    }
  }

  const updated: ResearchRule = { ...rule, status: to, updatedAt: now };
  const nextRules = [...rules];
  nextRules[index] = updated;
  return { ok: true, rules: nextRules };
}
