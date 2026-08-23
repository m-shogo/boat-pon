import type { ForwardTestResult, ResearchRule, RuleStatus } from "./researchRule";
import { canTransitionRuleStatus, validateProductionEligibility } from "./researchRuleLifecycle";

/**
 * Rule Lifecycle永続化の最小実装（Phase 3）。
 *
 * このファイルは純粋関数のみ。ファイルI/O・DBアクセスは一切行わない
 * （書き込み先はscripts/manage-research-rules.tsが担当する）。
 *
 * 安全装置:
 * - 新規ルールは必ず"candidate"から始まる（createResearchRule / addRule）
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

function parseCanonicalLifecycleTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateRuleRecordFields(rule: ResearchRule, subject: "new rule" | "persisted rule"): string | null {
  if (typeof rule.ruleId !== "string" || rule.ruleId.length === 0 || rule.ruleId.trim() !== rule.ruleId) {
    return `${subject} ruleId must be a non-blank, trimmed string`;
  }
  if (typeof rule.reasonSummary !== "string" || rule.reasonSummary.trim().length === 0) {
    return `${subject} reasonSummary must be a non-blank string`;
  }
  if (!Array.isArray(rule.warnings) || !rule.warnings.every((warning) => typeof warning === "string")) {
    return `${subject} warnings must be an array of strings`;
  }
  if (rule.title !== undefined && (typeof rule.title !== "string" || rule.title.trim().length === 0)) {
    return `${subject} title must be a non-blank string when provided`;
  }
  return null;
}

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
  const recordError = validateRuleRecordFields(rule, "new rule");
  if (recordError !== null) {
    return { ok: false, error: { ruleId: String(rule.ruleId), reason: recordError } };
  }
  if (findRule(rules, rule.ruleId)) {
    return { ok: false, error: { ruleId: rule.ruleId, reason: `rule "${rule.ruleId}" already exists` } };
  }
  if (rule.status !== "candidate") {
    return {
      ok: false,
      error: { ruleId: rule.ruleId, reason: "new rules must enter the registry at candidate status" },
    };
  }
  const createdAt = parseCanonicalLifecycleTimestamp(rule.createdAt);
  const updatedAt = parseCanonicalLifecycleTimestamp(rule.updatedAt);
  if (createdAt === null || updatedAt === null) {
    return {
      ok: false,
      error: { ruleId: rule.ruleId, reason: "new rule lifecycle timestamps must be canonical explicit-zone ISO-8601 values" },
    };
  }
  if (createdAt !== updatedAt) {
    return {
      ok: false,
      error: { ruleId: rule.ruleId, reason: "new rule createdAt and updatedAt must represent the same instant" },
    };
  }
  return { ok: true, rules: [...rules, rule] };
}

/**
 * 1件のルールの状態遷移を試みる。
 * - 未登録ruleId、重複してidentityが曖昧なruleId、canTransitionRuleStatusで許可されない遷移は拒否する
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
  const matchingIndexes: number[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    if (rules[index].ruleId === ruleId) matchingIndexes.push(index);
  }

  if (matchingIndexes.length === 0) {
    return { ok: false, error: { ruleId, reason: `rule "${ruleId}" not found` } };
  }
  if (matchingIndexes.length !== 1) {
    return {
      ok: false,
      error: {
        ruleId,
        reason: `rule "${ruleId}" has ${matchingIndexes.length} registry entries; transition identity is ambiguous`,
      },
    };
  }

  const index = matchingIndexes[0];
  const rule = rules[index];
  const recordError = validateRuleRecordFields(rule, "persisted rule");
  if (recordError !== null) {
    return { ok: false, error: { ruleId: String(rule.ruleId), reason: recordError } };
  }
  const createdAt = parseCanonicalLifecycleTimestamp(rule.createdAt);
  const updatedAt = parseCanonicalLifecycleTimestamp(rule.updatedAt);
  const transitionAt = parseCanonicalLifecycleTimestamp(now);
  if (createdAt === null || updatedAt === null || transitionAt === null) {
    return {
      ok: false,
      error: { ruleId, reason: "rule lifecycle timestamps must be canonical explicit-zone ISO-8601 values" },
    };
  }
  if (updatedAt < createdAt) {
    return {
      ok: false,
      error: { ruleId, reason: "rule updatedAt precedes createdAt; lifecycle chronology is invalid" },
    };
  }
  if (transitionAt < updatedAt) {
    return {
      ok: false,
      error: { ruleId, reason: "transition timestamp precedes the current rule updatedAt" },
    };
  }

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
    const evaluationRunAt = parseCanonicalLifecycleTimestamp(evaluation.metadata.evaluationRunAt);
    if (evaluationRunAt === null || transitionAt < evaluationRunAt) {
      return {
        ok: false,
        error: { ruleId, reason: "production transition timestamp precedes the forward evaluation run" },
      };
    }
  }

  const updated: ResearchRule = { ...rule, status: to, updatedAt: now };
  const nextRules = [...rules];
  nextRules[index] = updated;
  return { ok: true, rules: nextRules };
}
