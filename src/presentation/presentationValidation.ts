import type {
  LifecyclePresentation,
  LifecycleStepPresentation,
  MetricPresentation,
  OpportunityPresentation,
  ResearchSummaryPresentation,
  RuleCardPresentation,
  WarningPresentation,
} from "./presentationModel";

/**
 * Presentation Layer の安全装置（Phase H）。
 *
 * ここで確認するのは「表示契約が汚染されていないか」であり、ROI/リスク
 * 計算のロジックではない。具体的には:
 * - JSONへシリアライズ可能か（関数・undefined・循環参照を含まない）
 * - 想定していないキー（decision_historyの生カラム名 race_id/payout_yen
 *   のようなDBエンティティ由来の値）が紛れ込んでいないか
 *
 * 「決定的であるか」はビルダーの実装（純粋関数であること）そのものが
 * 保証する性質であり、単体の値からは検証できないため、Phase I の
 * スナップショットテストで担保する（同じ入力を2回渡して同じ出力になるか）。
 */

export type ValidationResult = {
  ok: boolean;
  issues: string[];
};

/**
 * JSON.stringify自体は関数/undefined/NaN等を黙って落とす（またはnullへ変換する）
 * ため、そのラウンドトリップだけでは「本当にJSONとして情報欠損がないか」を
 * 検知できない。ここでは値の型を再帰的に見て、JSONに素直に写像できる形
 * （プレーンオブジェクト/配列/文字列/有限数値/真偽値/null）だけを許可する。
 */
export function isJsonSerializable(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    return false;
  }
  if (Array.isArray(value)) return value.every(isJsonSerializable);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isJsonSerializable);
  }
  return false;
}

function hasOnlyAllowedKeys(value: unknown, allowed: Set<string>): boolean {
  if (typeof value !== "object" || value === null) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

function makeShapeValidator<T>(name: string, allowedKeys: Set<string>) {
  return (value: T): ValidationResult => {
    const issues: string[] = [];
    if (!hasOnlyAllowedKeys(value, allowedKeys)) {
      issues.push(`${name} has unexpected keys (possible raw DB entity leakage)`);
    }
    if (!isJsonSerializable(value)) {
      issues.push(`${name} is not JSON-serializable`);
    }
    return { ok: issues.length === 0, issues };
  };
}

const validateWarningShape = makeShapeValidator<WarningPresentation>(
  "WarningPresentation",
  new Set(["id", "label", "severity", "message"]),
);

const validateMetricShape = makeShapeValidator<MetricPresentation>(
  "MetricPresentation",
  new Set(["id", "label", "value", "displayValue"]),
);

const validateLifecycleStepShape = makeShapeValidator<LifecycleStepPresentation>(
  "LifecycleStepPresentation",
  new Set(["id", "label", "isCompleted", "isCurrent"]),
);

const validateLifecycleShape = makeShapeValidator<LifecyclePresentation>(
  "LifecyclePresentation",
  new Set(["steps", "currentStepId"]),
);

const validateOpportunityShape = makeShapeValidator<OpportunityPresentation>(
  "OpportunityPresentation",
  new Set(["score", "scoreLabel", "riskLevel", "summary"]),
);

const validateRuleCardShape = makeShapeValidator<RuleCardPresentation>(
  "RuleCardPresentation",
  new Set([
    "id", "title", "status", "scoreLabel", "roi", "hitRate", "sampleSize", "confidence",
    "riskLevel", "warnings", "reasonSummary", "lifecycle", "metrics", "opportunity",
    "isForwardTested", "isProductionEligible", "updatedAt",
  ]),
);

const validateResearchSummaryShape = makeShapeValidator<ResearchSummaryPresentation>(
  "ResearchSummaryPresentation",
  new Set(["generatedAt", "ruleCards", "totalWarnings"]),
);

export function validateWarningPresentation(warning: WarningPresentation): ValidationResult {
  return validateWarningShape(warning);
}

export function validateOpportunityPresentation(opportunity: OpportunityPresentation): ValidationResult {
  return validateOpportunityShape(opportunity);
}

export function validateLifecyclePresentation(lifecycle: LifecyclePresentation): ValidationResult {
  const issues = [...validateLifecycleShape(lifecycle).issues];
  for (const step of lifecycle.steps ?? []) {
    issues.push(...validateLifecycleStepShape(step).issues);
  }
  return { ok: issues.length === 0, issues };
}

/** RuleCardPresentation本体だけでなく、内包するwarnings/metrics/lifecycle/opportunityも再帰的に検証する。 */
export function validateRuleCardPresentation(card: RuleCardPresentation): ValidationResult {
  const issues = [...validateRuleCardShape(card).issues];
  for (const warning of card.warnings ?? []) issues.push(...validateWarningShape(warning).issues);
  for (const metric of card.metrics ?? []) issues.push(...validateMetricShape(metric).issues);
  issues.push(...validateLifecyclePresentation(card.lifecycle).issues);
  issues.push(...validateOpportunityShape(card.opportunity).issues);
  return { ok: issues.length === 0, issues };
}

export function validateResearchSummaryPresentation(summary: ResearchSummaryPresentation): ValidationResult {
  const issues = [...validateResearchSummaryShape(summary).issues];
  for (const card of summary.ruleCards ?? []) issues.push(...validateRuleCardPresentation(card).issues);
  return { ok: issues.length === 0, issues };
}

/** 同じ入力から常に同じ出力になるか（純粋関数であるか）をテストで確認するためのヘルパー。 */
export function isDeterministic<T>(build: () => T, attempts = 3): boolean {
  const first = JSON.stringify(build());
  for (let i = 1; i < attempts; i++) {
    if (JSON.stringify(build()) !== first) return false;
  }
  return true;
}
