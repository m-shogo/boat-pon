import type { DecisionHistoryRow } from "./backtest";
import { applyCondition, SUPPORTED_CONDITION_KEYS } from "./researchEvaluation";
import type { ResearchRuleEvaluationCondition } from "./researchRule";

/**
 * ResearchRuleの評価条件（Phase 5.2最小実装）を、既存のROI Explorer条件フィルタ
 * （`src/domain/researchEvaluation.ts`の`applyCondition`/`SUPPORTED_CONDITION_KEYS`）
 * に薄く委譲するための純粋関数群。ここでは条件フィルタのロジックを再実装しない。
 *
 * - allowlist方式: key/operatorともに未知・未対応ならthrowせずwarningへ積んで無視する
 * - 対応operatorは"equals"のみ（複雑な比較・範囲・OR・正規表現・任意JS式は対象外）
 * - SQL文字列の生成・組み立ては一切行わない（decision_historyへのアクセスは
 *   既存のread-only CLIが担う。ここでは配列フィルタのみ）
 * - arbitrary code execution経路（eval/new Function等）は一切使わない
 *
 * このファイルは純粋関数のみ。DB/ファイルアクセスは一切行わない。
 */

export type ResearchRuleConditionValidation = {
  /** operator/keyともにallowlistを通過した条件のみ。 */
  validConditions: ResearchRuleEvaluationCondition[];
  /** unsupported operator・unknown keyの理由を含むwarnings。throwはしない。 */
  warnings: string[];
};

/**
 * conditionsをallowlist方式で検証する。
 * - operatorが"equals"以外ならwarningに積んで無視する
 * - keyが`SUPPORTED_CONDITION_KEYS`（venue/raceNo/decision、既存ROI Explorerと同じ）
 *   以外ならwarningに積んで無視する
 * - 例外は投げない（安全側に倒す）
 */
export function validateResearchRuleConditions(
  conditions: ResearchRuleEvaluationCondition[] | undefined,
): ResearchRuleConditionValidation {
  const validConditions: ResearchRuleEvaluationCondition[] = [];
  const warnings: string[] = [];

  for (const condition of conditions ?? []) {
    if (condition.operator !== "equals") {
      warnings.push(
        `unsupported operator "${condition.operator}" for evaluation condition key "${condition.key}"; condition ignored (only "equals" is supported)`,
      );
      continue;
    }
    if (!(SUPPORTED_CONDITION_KEYS as readonly string[]).includes(condition.key)) {
      warnings.push(
        `unknown evaluation condition key "${condition.key}" (supported: ${SUPPORTED_CONDITION_KEYS.join(", ")}); condition ignored`,
      );
      continue;
    }
    validConditions.push(condition);
  }

  return { validConditions, warnings };
}

export type ResearchRuleEvaluationScope = "rule-specific" | "shared-fallback" | "invalid-condition-fallback";

/**
 * conditionsの有無・妥当性から評価スコープを判定するだけで、ROI/severityの判定は行わない。
 * - 未指定/空配列 -> "shared-fallback"（従来通り共通集計）
 * - 指定はあるが有効な条件が1つも無い -> "invalid-condition-fallback"（共通集計へ安全にfallback）
 * - 有効な条件が1つ以上ある -> "rule-specific"
 */
export function determineEvaluationScope(
  conditions: ResearchRuleEvaluationCondition[] | undefined,
): ResearchRuleEvaluationScope {
  if (!conditions || conditions.length === 0) return "shared-fallback";
  const { validConditions } = validateResearchRuleConditions(conditions);
  return validConditions.length > 0 ? "rule-specific" : "invalid-condition-fallback";
}

/** ruleにルール固有の（適用可能な）評価条件があるかどうかだけを返す。 */
export function hasRuleSpecificConditions(conditions: ResearchRuleEvaluationCondition[] | undefined): boolean {
  return determineEvaluationScope(conditions) === "rule-specific";
}

export type ApplyResearchRuleConditionsResult = {
  rows: DecisionHistoryRow[];
  warnings: string[];
};

/**
 * allowlistを通過した条件だけを、既存の`applyCondition`（ROI Explorerと共通）で
 * 順に適用する（AND結合）。対象データ（rows）は破壊しない（毎回新しい配列を返す）。
 * conditions未指定・全滅（invalid）の場合は入力rowsをそのまま返す
 * （shared-fallback/invalid-condition-fallbackと同じ挙動になる）。
 */
export function applyResearchRuleConditions(
  rows: DecisionHistoryRow[],
  conditions: ResearchRuleEvaluationCondition[] | undefined,
): ApplyResearchRuleConditionsResult {
  const { validConditions, warnings } = validateResearchRuleConditions(conditions);

  let filteredRows = rows;
  const allWarnings = [...warnings];
  for (const condition of validConditions) {
    const result = applyCondition(filteredRows, { key: condition.key, value: String(condition.value) });
    filteredRows = result.rows;
    allWarnings.push(...result.warnings);
  }

  return { rows: filteredRows, warnings: allWarnings };
}

/** 有効な条件だけを、Daily Reportに表示できる短い文字列へ変換する（判定ロジックなし、表示用の言い換えのみ）。 */
export function describeResearchRuleConditions(conditions: ResearchRuleEvaluationCondition[] | undefined): string[] {
  const { validConditions } = validateResearchRuleConditions(conditions);
  return validConditions.map((condition) => `${condition.key} ${condition.operator} ${JSON.stringify(condition.value)}`);
}
