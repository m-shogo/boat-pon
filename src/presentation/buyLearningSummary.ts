export const BUY_LEARNING_SCHEMA_VERSION = "buy-learning-public-summary-v1" as const;

export type BuyLearningSummary = {
  schemaVersion: typeof BUY_LEARNING_SCHEMA_VERSION;
  generatedAt: string;
  status: "AVAILABLE" | "NOT_AVAILABLE";
  source: "DECISION_HISTORY_DERIVED" | "NOT_AVAILABLE";
  window: { from: string | null; to: string | null; label: string };
  performance: {
    totalDecisions: number | null;
    settled: number | null;
    hits: number | null;
    misses: number | null;
    hitRate: number | null;
    roi: number | null;
    roiExMax: number | null;
  };
  recent: {
    settled: number | null;
    hits: number | null;
    misses: number | null;
    hitRate: number | null;
    roi: number | null;
  };
  learnings: Array<{ id: string; severity: "INFO" | "WATCH" | "ACTION"; title: string; summary: string; evidenceCount: number }>;
  failurePatterns: Array<{ id: string; label: string; count: number; share: number | null }>;
  researchCandidates: Array<{ id: string; title: string; reason: string; status: "PROPOSED"; productionChangeAllowed: false }>;
};

export type BuyLearningAggregateInput = {
  generatedAt: string;
  from?: string | null;
  to?: string | null;
  totalDecisions: number;
  settled: number;
  hits: number;
  payoutOddsSum: number;
  maxPayoutOdds: number;
  avgEstimatedHitRate: number | null;
  recentSettled: number;
  recentHits: number;
  recentPayoutOddsSum: number;
  smallSampleMisses: number;
  highConfidenceMisses: number;
  highEvMisses: number;
};

export function buildBuyLearningSummary(input: BuyLearningAggregateInput): BuyLearningSummary {
  const misses = Math.max(0, input.settled - input.hits);
  const roi = ratio(input.payoutOddsSum, input.settled);
  const roiExMax = input.settled - (input.maxPayoutOdds > 0 ? 1 : 0) > 0
    ? ratio(input.payoutOddsSum - input.maxPayoutOdds, input.settled - (input.maxPayoutOdds > 0 ? 1 : 0))
    : null;
  const hitRate = ratio(input.hits, input.settled);
  const recentMisses = Math.max(0, input.recentSettled - input.recentHits);
  const recentHitRate = ratio(input.recentHits, input.recentSettled);
  const recentRoi = ratio(input.recentPayoutOddsSum, input.recentSettled);

  const learnings: BuyLearningSummary["learnings"] = [];
  const researchCandidates: BuyLearningSummary["researchCandidates"] = [];

  if (input.settled > 0 && roi !== null && roi < 1) {
    learnings.push({ id: "ROI_BELOW_BREAK_EVEN", severity: "ACTION", title: "BUY収益性は改善余地あり", summary: "settled BUYの集計ROIが損益分岐を下回っています。条件を自動変更せず、失敗群の再現性を研究対象にします。", evidenceCount: input.settled });
    researchCandidates.push({ id: "RESEARCH-BUY-LOSS-SEGMENTS", title: "BUY損失セグメント再検証", reason: "settled BUYのROIが損益分岐未満", status: "PROPOSED", productionChangeAllowed: false });
  }

  if (roi !== null && roiExMax !== null && roi - roiExMax >= 0.15) {
    learnings.push({ id: "MAX_HIT_DEPENDENCE", severity: "WATCH", title: "最大払戻への依存を監視", summary: "最大1件を除いたROIが大きく低下します。単発高配当に依存しない再現性を優先して評価します。", evidenceCount: input.settled });
    researchCandidates.push({ id: "RESEARCH-TAIL-DEPENDENCE", title: "最大hit依存性の時系列検証", reason: "ROIとmax-hit除外ROIの差が大きい", status: "PROPOSED", productionChangeAllowed: false });
  }

  if (input.avgEstimatedHitRate !== null && hitRate !== null && input.avgEstimatedHitRate - hitRate >= 0.05) {
    learnings.push({ id: "CALIBRATION_GAP", severity: "ACTION", title: "的中確率の過大評価を疑う", summary: "平均推定的中率が実現的中率を上回っています。確率校正と市場価格の分離評価を研究候補にします。", evidenceCount: input.settled });
    researchCandidates.push({ id: "RESEARCH-CALIBRATION-GAP", title: "BUY確率校正レビュー", reason: "推定的中率と実現的中率に差がある", status: "PROPOSED", productionChangeAllowed: false });
  }

  if (input.smallSampleMisses > 0) {
    learnings.push({ id: "SMALL_SAMPLE_MISSES", severity: "WATCH", title: "小標本由来の失敗を分離", summary: "BUY missの一部が小標本条件に集中しています。標本量だけを理由にproduction条件は変更せず、共通cohortで再評価します。", evidenceCount: input.smallSampleMisses });
    researchCandidates.push({ id: "RESEARCH-SAMPLE-SIZE-RISK", title: "小標本BUYのcommon-cohort評価", reason: "小標本条件のmissが観測された", status: "PROPOSED", productionChangeAllowed: false });
  }

  if (input.highConfidenceMisses > 0) {
    learnings.push({ id: "HIGH_CONFIDENCE_MISSES", severity: "WATCH", title: "高信頼missを重点レビュー", summary: "高い推定確率でも外れたBUYが存在します。特徴量リークではなく校正・regime差・市場差を優先して切り分けます。", evidenceCount: input.highConfidenceMisses });
    researchCandidates.push({ id: "RESEARCH-HIGH-CONFIDENCE-MISS", title: "高信頼miss原因分解", reason: "高推定確率のmissが観測された", status: "PROPOSED", productionChangeAllowed: false });
  }

  if (input.highEvMisses > 0) {
    learnings.push({ id: "HIGH_EV_MISSES", severity: "INFO", title: "高EV missを価格と確率に分解", summary: "高EV判定でも外れたケースを、確率誤差と価格評価のどちらが支配したか分離して研究します。", evidenceCount: input.highEvMisses });
  }

  if (!learnings.length && input.settled > 0) {
    learnings.push({ id: "NO_DOMINANT_FAILURE_SIGNAL", severity: "INFO", title: "支配的な失敗シグナルなし", summary: "現在の集計だけでは単一の失敗要因を断定できません。追加cohortで継続観測します。", evidenceCount: input.settled });
  }

  const failurePatterns: BuyLearningSummary["failurePatterns"] = [
    { id: "SMALL_SAMPLE", label: "小標本miss", count: input.smallSampleMisses, share: ratio(input.smallSampleMisses, misses) },
    { id: "HIGH_CONFIDENCE", label: "高信頼miss", count: input.highConfidenceMisses, share: ratio(input.highConfidenceMisses, misses) },
    { id: "HIGH_EV", label: "高EV miss", count: input.highEvMisses, share: ratio(input.highEvMisses, misses) },
  ].filter((item) => item.count > 0);

  const summary: BuyLearningSummary = {
    schemaVersion: BUY_LEARNING_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: input.settled > 0 ? "AVAILABLE" : "NOT_AVAILABLE",
    source: input.settled > 0 ? "DECISION_HISTORY_DERIVED" : "NOT_AVAILABLE",
    window: { from: input.from ?? null, to: input.to ?? null, label: input.from || input.to ? `${input.from ?? "…"} → ${input.to ?? "…"}` : "all settled BUY evidence" },
    performance: { totalDecisions: input.totalDecisions, settled: input.settled, hits: input.hits, misses, hitRate, roi, roiExMax },
    recent: { settled: input.recentSettled, hits: input.recentHits, misses: recentMisses, hitRate: recentHitRate, roi: recentRoi },
    learnings: learnings.slice(0, 6),
    failurePatterns: failurePatterns.slice(0, 6),
    researchCandidates: dedupeCandidates(researchCandidates).slice(0, 6),
  };
  const errors = validateBuyLearningSummary(summary);
  if (errors.length) throw new Error(`buy learning summary invalid: ${errors.join("; ")}`);
  return summary;
}

export function unavailableBuyLearningSummary(generatedAt: string): BuyLearningSummary {
  return {
    schemaVersion: BUY_LEARNING_SCHEMA_VERSION,
    generatedAt,
    status: "NOT_AVAILABLE",
    source: "NOT_AVAILABLE",
    window: { from: null, to: null, label: "private outcome evidence unavailable" },
    performance: { totalDecisions: null, settled: null, hits: null, misses: null, hitRate: null, roi: null, roiExMax: null },
    recent: { settled: null, hits: null, misses: null, hitRate: null, roi: null },
    learnings: [],
    failurePatterns: [],
    researchCandidates: [],
  };
}

export function validateBuyLearningSummary(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["summary must be object"];
  if (value.schemaVersion !== BUY_LEARNING_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!isIso(value.generatedAt)) errors.push("invalid generatedAt");
  if (!["AVAILABLE", "NOT_AVAILABLE"].includes(String(value.status))) errors.push("invalid status");
  const serialized = JSON.stringify(value);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "/Users/", "/home/", "app_settings", "automation/requests"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`forbidden public field/value: ${forbidden}`);
  }
  if (serialized.length > 24000) errors.push("summary too large");
  return errors;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}
function dedupeCandidates(items: BuyLearningSummary["researchCandidates"]): BuyLearningSummary["researchCandidates"] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
