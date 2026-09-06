import type { DecisionHistoryRow } from "./backtest";
import type { EvaluationMetadata, RuleEvaluationResult } from "./researchRule";

export type EvaluationMetadataValidation = {
  ok: boolean;
  warnings: string[];
};

function isCanonicalCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isExplicitIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;
  if (!isCanonicalCalendarDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Future Leak防止の最小チェック。
 * data windowはcanonicalなGregorian YYYY-MM-DD、evaluationRunAtはexplicit timezone付きISO-8601を必須とする。
 * 欠損・違反は例外にせず warnings に積み、ok=false で返す。
 */
export function validateEvaluationMetadata(metadata: Partial<EvaluationMetadata>): EvaluationMetadataValidation {
  const warnings: string[] = [];
  const { dataWindowStart, dataWindowEnd, evaluationRunAt, sampleSize } = metadata;

  if (!dataWindowStart) warnings.push("dataWindowStart is missing");
  if (!dataWindowEnd) warnings.push("dataWindowEnd is missing");
  if (!evaluationRunAt) warnings.push("evaluationRunAt is missing");
  if (sampleSize == null) warnings.push("sampleSize is missing");

  if (dataWindowStart && !isCanonicalCalendarDate(dataWindowStart)) {
    warnings.push(`dataWindowStart ${String(dataWindowStart)} must be a canonical Gregorian YYYY-MM-DD date`);
  }
  if (dataWindowEnd && !isCanonicalCalendarDate(dataWindowEnd)) {
    warnings.push(`dataWindowEnd ${String(dataWindowEnd)} must be a canonical Gregorian YYYY-MM-DD date`);
  }
  if (evaluationRunAt && !isExplicitIsoTimestamp(evaluationRunAt)) {
    warnings.push(`evaluationRunAt ${String(evaluationRunAt)} must be an explicit-zone ISO-8601 timestamp`);
  }

  if (isCanonicalCalendarDate(dataWindowStart)
    && isCanonicalCalendarDate(dataWindowEnd)
    && dataWindowStart > dataWindowEnd) {
    warnings.push(`dataWindowStart ${dataWindowStart} is after dataWindowEnd ${dataWindowEnd}`);
  }
  if (isCanonicalCalendarDate(dataWindowEnd)
    && isExplicitIsoTimestamp(evaluationRunAt)
    && dataWindowEnd > evaluationRunAt.slice(0, 10)) {
    warnings.push(`dataWindowEnd ${dataWindowEnd} is after evaluationRunAt ${evaluationRunAt} (future leak risk)`);
  }
  if (sampleSize != null && (!Number.isSafeInteger(sampleSize) || sampleSize < 0)) {
    warnings.push(`sampleSize ${sampleSize} must be a non-negative safe integer`);
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
 * 行1件の実現payoutを返す。
 * 的中したsettled行は公式 `payout_yen` を必須とし、欠落時は近似oddsへfallbackせずfail-closedにする。
 * 外れ行は公式払戻0円なので `payout_yen` の保存有無にかかわらず0を返す。
 */
export function realizedPayoutYen(row: DecisionHistoryRow, stakeYen: number): number {
  if (row.result !== row.selection || stakeYen <= 0) return 0;
  if (row.payoutYen == null || !Number.isFinite(row.payoutYen) || row.payoutYen <= 0) {
    throw new Error(`RESEARCH_OFFICIAL_PAYOUT_MISSING race=${row.raceId} selection=${row.selection}`);
  }
  return (row.payoutYen / 100) * stakeYen;
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
 * - 的中行のROIは公式 payout_yen のみ。欠落時はfail-closedで評価を生成しない
 * - 外れ行のpayout_yen欠落は0円払戻として正常
 * - 探索用なので isForwardTested / isProductionEligible は常に false
 */
export function buildRuleEvaluationResult(input: BuildRuleEvaluationInput): RuleEvaluationResult {
  const windowRows = input.rows.filter(
    (row) => row.date >= input.dataWindowStart && row.date <= input.dataWindowEnd,
  );
  const buyRows = windowRows.filter((row) => row.decision === "BUY");
  const settledBuyRows = buyRows.filter((row) => row.result != null);
  const missingHitPayoutRows = settledBuyRows.filter(
    (row) => row.result === row.selection
      && (row.payoutYen == null || !Number.isFinite(row.payoutYen) || row.payoutYen <= 0),
  );
  if (missingHitPayoutRows.length > 0) {
    const sample = missingHitPayoutRows.slice(0, 5).map((row) => row.raceId).join(",");
    throw new Error(`RESEARCH_OFFICIAL_PAYOUT_COVERAGE_INCOMPLETE hits=${missingHitPayoutRows.length} races=${sample}`);
  }

  const hits = settledBuyRows.filter((row) => row.result === row.selection).length;
  const stakeYen = settledBuyRows.reduce((sum, row) => sum + row.recommendedStakeYen, 0);
  const payoutYen = settledBuyRows.reduce((sum, row) => sum + realizedPayoutYen(row, row.recommendedStakeYen), 0);
  const roiBasis = settledBuyRows.length === 0 ? "n/a" : "payout_yen";

  const metadata: EvaluationMetadata = {
    dataWindowStart: input.dataWindowStart,
    dataWindowEnd: input.dataWindowEnd,
    evaluationRunAt: input.evaluationRunAt,
    sampleSize: settledBuyRows.length,
  };

  const warnings = [...validateEvaluationMetadata(metadata).warnings];
  const unsettled = buyRows.length - settledBuyRows.length;
  if (unsettled > 0) warnings.push(`${unsettled} BUY rows are unsettled and excluded from roi/hitRate`);
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
