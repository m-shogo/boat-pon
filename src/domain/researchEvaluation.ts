import { oddsPayoutYen, type DecisionHistoryRow } from "./backtest";
import type { EvaluationMetadata, RuleEvaluationResult } from "./researchRule";

export type EvaluationMetadataValidation = {
  ok: boolean;
  warnings: string[];
};

/**
 * Future Leak防止の最小チェック。日時はISO-8601文字列前提（辞書順比較で成立する形式のみ）。
 * 欠損・違反は例外にせず warnings に積み、ok=false で返す。
 */
export function validateEvaluationMetadata(metadata: Partial<EvaluationMetadata>): EvaluationMetadataValidation {
  const warnings: string[] = [];
  const { dataWindowStart, dataWindowEnd, evaluationRunAt, sampleSize } = metadata;

  if (!dataWindowStart) warnings.push("dataWindowStart is missing");
  if (!dataWindowEnd) warnings.push("dataWindowEnd is missing");
  if (!evaluationRunAt) warnings.push("evaluationRunAt is missing");
  if (sampleSize == null) warnings.push("sampleSize is missing");

  if (dataWindowStart && dataWindowEnd && dataWindowStart > dataWindowEnd) {
    warnings.push(`dataWindowStart ${dataWindowStart} is after dataWindowEnd ${dataWindowEnd}`);
  }
  if (dataWindowEnd && evaluationRunAt && dataWindowEnd > evaluationRunAt) {
    warnings.push(`dataWindowEnd ${dataWindowEnd} is after evaluationRunAt ${evaluationRunAt} (future leak risk)`);
  }
  if (sampleSize != null && (!Number.isFinite(sampleSize) || sampleSize < 0)) {
    warnings.push(`sampleSize ${sampleSize} must be a non-negative finite number`);
  }

  return { ok: warnings.length === 0, warnings };
}

/**
 * sampleSize=200（MIN_PRODUCTION_SAMPLE_SIZE）で confidence がちょうど 0.8
 * （MIN_PRODUCTION_CONFIDENCE）になるよう合わせた暫定の縮小重み。
 * Bayesian Estimate導入時に置き換える前提（docs/ai/04-ROADMAP.md 参照）。
 */
export const CONFIDENCE_PRIOR_WEIGHT = 50;

export function estimateConfidence(sampleSize: number): number {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0;
  return sampleSize / (sampleSize + CONFIDENCE_PRIOR_WEIGHT);
}

/**
 * 行1件の実現payoutを返す。`payout_yen`（race_payouts由来、100円あたりの公式払戻額）が
 * あればそれをstakeYenへスケールして使う。無い場合のみ current_odds ベースの
 * `oddsPayoutYen` にfallbackする（CLAUDE.mdの主評価基準 = 実払戻ベースに合わせる）。
 */
export function realizedPayoutYen(row: DecisionHistoryRow, stakeYen: number): number {
  if (row.result !== row.selection || stakeYen <= 0) return 0;
  if (row.payoutYen != null) return (row.payoutYen / 100) * stakeYen;
  return oddsPayoutYen(row, stakeYen);
}

/** 総投入額に対する最大ピーク→谷の落ち込み比。BUY行を日付順に累積して計算する。 */
export function computeMaxDrawdown(rows: DecisionHistoryRow[]): number {
  const buyRows = rows
    .filter((row) => row.decision === "BUY")
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let cumulative = 0;
  let peak = 0;
  let maxDrop = 0;
  let totalStake = 0;
  for (const row of buyRows) {
    const stake = row.recommendedStakeYen;
    totalStake += stake;
    cumulative += realizedPayoutYen(row, stake) - stake;
    peak = Math.max(peak, cumulative);
    maxDrop = Math.max(maxDrop, peak - cumulative);
  }
  return totalStake ? maxDrop / totalStake : 0;
}

export function currentOddsFallbackWarning(fallbackCount: number): string {
  return `${fallbackCount} settled BUY row(s) lack payout_yen; used current_odds-based ROI for those rows (approx. +14.94pt optimistic bias)`;
}

export type BuildRuleEvaluationInput = {
  ruleId: string;
  rows: DecisionHistoryRow[];
  dataWindowStart: string;
  dataWindowEnd: string;
  evaluationRunAt: string;
  reasonSummary?: string;
  conditionLabel?: string;
  extraWarnings?: string[];
};

/**
 * decision_history 行を RuleEvaluationResult へ変換する読み取り専用アダプタ。
 * - dataWindow 外の行は集計に使わない（Future Leak防止）
 * - ROI/hitRate/sampleSize は結果確定済みのBUY行のみで計算する
 * - ROIは payout_yen（実払戻）優先、無い行のみ current_odds へfallback
 * - 探索用なので isForwardTested / isProductionEligible は常に false
 */
export function buildRuleEvaluationResult(input: BuildRuleEvaluationInput): RuleEvaluationResult {
  const windowRows = input.rows.filter(
    (row) => row.date >= input.dataWindowStart && row.date <= input.dataWindowEnd,
  );
  const buyRows = windowRows.filter((row) => row.decision === "BUY");
  const settledBuyRows = buyRows.filter((row) => row.result != null);
  const hits = settledBuyRows.filter((row) => row.result === row.selection).length;
  const stakeYen = settledBuyRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const payoutYen = settledBuyRows.reduce((sum, row) => sum + realizedPayoutYen(row, row.recommendedStakeYen), 0);
  const fallbackCount = settledBuyRows.filter((row) => row.payoutYen == null).length;
  const roiBasis = settledBuyRows.length === 0
    ? "n/a"
    : fallbackCount === 0
      ? "payout_yen"
      : fallbackCount === settledBuyRows.length
        ? "current_odds (fallback)"
        : `mixed (${settledBuyRows.length - fallbackCount}/${settledBuyRows.length} payout_yen)`;

  const metadata: EvaluationMetadata = {
    dataWindowStart: input.dataWindowStart,
    dataWindowEnd: input.dataWindowEnd,
    evaluationRunAt: input.evaluationRunAt,
    sampleSize: settledBuyRows.length,
  };

  const warnings = [...validateEvaluationMetadata(metadata).warnings];
  const unsettled = buyRows.length - settledBuyRows.length;
  if (unsettled > 0) warnings.push(`${unsettled} BUY rows are unsettled and excluded from roi/hitRate`);
  if (fallbackCount > 0) warnings.push(currentOddsFallbackWarning(fallbackCount));
  warnings.push(...(input.extraWarnings ?? []));

  const conditionSuffix = input.conditionLabel ? `; condition: ${input.conditionLabel}` : "";

  return {
    ruleId: input.ruleId,
    metadata,
    hitRate: settledBuyRows.length ? hits / settledBuyRows.length : 0,
    roi: stakeYen ? payoutYen / stakeYen : 0,
    confidence: estimateConfidence(settledBuyRows.length),
    maxDrawdown: computeMaxDrawdown(settledBuyRows),
    isForwardTested: false,
    isProductionEligible: false,
    reasonSummary:
      input.reasonSummary ??
      `explore-roi: ${settledBuyRows.length} settled BUY (${hits} hits) in ${input.dataWindowStart}..${input.dataWindowEnd}; roi basis: ${roiBasis}${conditionSuffix}`,
    warnings,
  };
}

export type RowCondition = {
  key: string;
  value: string;
};

/** `key=value` 形式のみ受け付ける。`=` が無い・keyが空なら不正入力としてthrowする。 */
export function parseCondition(raw: string): RowCondition {
  const eqIndex = raw.indexOf("=");
  if (eqIndex <= 0) throw new Error(`invalid --condition "${raw}", expected key=value`);
  return { key: raw.slice(0, eqIndex), value: raw.slice(eqIndex + 1) };
}

export const SUPPORTED_CONDITION_KEYS = ["venue", "raceNo", "decision"] as const;

export type ConditionFilterResult = {
  rows: DecisionHistoryRow[];
  warnings: string[];
};

/**
 * 単一条件のみの最小フィルタ（AND/OR組み合わせは対象外）。
 * 未対応keyや値の型不一致は絞り込みをせず（全件のまま）warningsで明示する。
 */
export function applyCondition(rows: DecisionHistoryRow[], condition: RowCondition): ConditionFilterResult {
  switch (condition.key) {
    case "venue":
      return { rows: rows.filter((row) => row.venue === condition.value), warnings: [] };
    case "raceNo": {
      const raceNo = Number(condition.value);
      if (!Number.isFinite(raceNo)) {
        return { rows, warnings: [`condition raceNo="${condition.value}" is not a number; condition ignored`] };
      }
      return { rows: rows.filter((row) => row.raceNo === raceNo), warnings: [] };
    }
    case "decision":
      return { rows: rows.filter((row) => row.decision === condition.value), warnings: [] };
    default:
      return {
        rows,
        warnings: [
          `unsupported condition key "${condition.key}" (supported: ${SUPPORTED_CONDITION_KEYS.join(", ")}); condition ignored`,
        ],
      };
  }
}
