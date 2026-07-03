import type { EvaluationMetadata } from "./researchRule";

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
