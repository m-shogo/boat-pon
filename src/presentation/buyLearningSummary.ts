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
  /** Probability that actually drove BUY EV. When supplied, learning must prefer this over the pre-calibration estimate. */
  avgDecisionEffectiveHitRate?: number | null;
  recentSettled: number;
  recentHits: number;
  recentPayoutOddsSum: number;
  smallSampleMisses: number;
  highConfidenceMisses: number;
  highEvMisses: number;
  /** Settled BUYs in the same high-EV cohort used by highEvMisses. */
  highEvSettled?: number;
};

const HIGH_EV_COMPARISON_MIN_PER_SIDE = 30;
const TOP_KEYS = new Set(["schemaVersion", "generatedAt", "status", "source", "window", "performance", "recent", "learnings", "failurePatterns", "researchCandidates"]);
const WINDOW_KEYS = new Set(["from", "to", "label"]);
const PERFORMANCE_KEYS = new Set(["totalDecisions", "settled", "hits", "misses", "hitRate", "roi", "roiExMax"]);
const RECENT_KEYS = new Set(["settled", "hits", "misses", "hitRate", "roi"]);
const LEARNING_KEYS = new Set(["id", "severity", "title", "summary", "evidenceCount"]);
const FAILURE_KEYS = new Set(["id", "label", "count", "share"]);
const CANDIDATE_KEYS = new Set(["id", "title", "reason", "status", "productionChangeAllowed"]);

export function buildBuyLearningSummary(input: BuyLearningAggregateInput): BuyLearningSummary {
  validateAggregateInput(input);
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
  const effectiveCalibrationRate = input.avgDecisionEffectiveHitRate !== undefined
    ? input.avgDecisionEffectiveHitRate
    : input.avgEstimatedHitRate;

  if (input.settled > 0 && roi !== null && roi < 1) {
    learnings.push({ id: "ROI_BELOW_BREAK_EVEN", severity: "ACTION", title: "BUY収益性は改善余地あり", summary: "settled BUYの集計ROIが損益分岐を下回っています。条件を自動変更せず、失敗群の再現性を研究対象にします。", evidenceCount: input.settled });
    researchCandidates.push({ id: "RESEARCH-BUY-LOSS-SEGMENTS", title: "BUY損失セグメント再検証", reason: "settled BUYのROIが損益分岐未満", status: "PROPOSED", productionChangeAllowed: false });
  }
  if (roi !== null && roiExMax !== null && roi - roiExMax >= 0.15) {
    learnings.push({ id: "MAX_HIT_DEPENDENCE", severity: "WATCH", title: "最大払戻への依存を監視", summary: "最大1件を除いたROIが大きく低下します。単発高配当に依存しない再現性を優先して評価します。", evidenceCount: input.settled });
    researchCandidates.push({ id: "RESEARCH-TAIL-DEPENDENCE", title: "最大hit依存性の時系列検証", reason: "ROIとmax-hit除外ROIの差が大きい", status: "PROPOSED", productionChangeAllowed: false });
  }
  if (effectiveCalibrationRate !== null && hitRate !== null && effectiveCalibrationRate - hitRate >= 0.05) {
    learnings.push({ id: "CALIBRATION_GAP", severity: "ACTION", title: "BUY判定確率の過大評価を疑う", summary: "BUY判定に実際に使った平均実効確率が実現的中率を大きく上回っています。確率校正と市場価格の分離評価を研究候補にします。", evidenceCount: input.settled });
    researchCandidates.push({ id: "RESEARCH-CALIBRATION-GAP", title: "BUY実効確率の校正レビュー", reason: "BUY判定実効確率と実現的中率に差がある", status: "PROPOSED", productionChangeAllowed: false });
  }
  if (input.smallSampleMisses > 0) {
    learnings.push({ id: "SMALL_SAMPLE_MISSES", severity: "WATCH", title: "小標本由来の失敗を分離", summary: "BUY missの一部が小標本条件に集中しています。標本量だけを理由にproduction条件は変更せず、共通cohortで再評価します。", evidenceCount: input.smallSampleMisses });
    researchCandidates.push({ id: "RESEARCH-SAMPLE-SIZE-RISK", title: "小標本BUYのcommon-cohort評価", reason: "小標本条件のmissが観測された", status: "PROPOSED", productionChangeAllowed: false });
  }
  if (input.highConfidenceMisses > 0) {
    learnings.push({ id: "HIGH_CONFIDENCE_MISSES", severity: "WATCH", title: "高信頼missを重点レビュー", summary: "高い推定確率でも外れたBUYが存在します。特徴量リークではなく校正・regime差・市場差を優先して切り分けます。", evidenceCount: input.highConfidenceMisses });
    researchCandidates.push({ id: "RESEARCH-HIGH-CONFIDENCE-MISS", title: "高信頼miss原因分解", reason: "高推定確率のmissが観測された", status: "PROPOSED", productionChangeAllowed: false });
  }

  const highEvClassification = classifyHighEvLearning(input);
  if (highEvClassification === "UNIVERSAL") {
    learnings.push({
      id: "HIGH_EV_BASELINE_UNINFORMATIVE",
      severity: "INFO",
      title: "高EVは失敗原因の比較軸になっていない",
      summary: "settled BUYの全件が高EV cohortに属するため、高EV missの多さだけでは高EV固有の失敗を示せません。価格・確率・tailは別Evidenceで評価します。",
      evidenceCount: input.settled,
    });
  } else if (highEvClassification === "PENDING") {
    learnings.push({
      id: "HIGH_EV_COMPARISON_PENDING",
      severity: "INFO",
      title: "高EV missは比較母集団待ち",
      summary: `高EV cohortと非高EV cohortの両側${HIGH_EV_COMPARISON_MIN_PER_SIDE}件supportが未成立です。比較が成立するまで高EVを失敗原因として扱いません。`,
      evidenceCount: input.highEvMisses,
    });
  } else if (highEvClassification === "COMPARABLE") {
    learnings.push({ id: "HIGH_EV_MISSES", severity: "INFO", title: "高EV cohortのmissを比較検証", summary: "高EV/非高EVの両側supportがあるため、高EV cohortのmissを価格・確率・tailへ分解して比較します。", evidenceCount: input.highEvMisses });
  } else if (highEvClassification === "LEGACY" && input.highEvMisses > 0) {
    learnings.push({ id: "HIGH_EV_MISSES", severity: "INFO", title: "高EV missを価格と確率に分解", summary: "高EV判定でも外れたケースを、確率誤差と価格評価のどちらが支配したか分離して研究します。", evidenceCount: input.highEvMisses });
  }

  if (!learnings.length && input.settled > 0) learnings.push({ id: "NO_DOMINANT_FAILURE_SIGNAL", severity: "INFO", title: "支配的な失敗シグナルなし", summary: "現在の集計だけでは単一の失敗要因を断定できません。追加cohortで継続観測します。", evidenceCount: input.settled });

  const highEvFailureIsComparable = highEvClassification === "COMPARABLE" || highEvClassification === "LEGACY";
  const failurePatterns: BuyLearningSummary["failurePatterns"] = [
    { id: "SMALL_SAMPLE", label: "小標本miss", count: input.smallSampleMisses, share: ratio(input.smallSampleMisses, misses) },
    { id: "HIGH_CONFIDENCE", label: "高信頼miss", count: input.highConfidenceMisses, share: ratio(input.highConfidenceMisses, misses) },
    ...(highEvFailureIsComparable ? [{ id: "HIGH_EV", label: "高EV cohort miss", count: input.highEvMisses, share: ratio(input.highEvMisses, misses) }] : []),
  ].filter((item) => item.count > 0);

  const summary: BuyLearningSummary = {
    schemaVersion: BUY_LEARNING_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: input.settled > 0 ? "AVAILABLE" : "NOT_AVAILABLE",
    source: input.settled > 0 ? "DECISION_HISTORY_DERIVED" : "NOT_AVAILABLE",
    window: { from: input.from ?? null, to: input.to ?? null, label: input.from || input.to ? `${input.from ?? "…"} → ${input.to ?? "…"}` : "all settled BUY evidence" },
    performance: { totalDecisions: input.totalDecisions, settled: input.settled, hits: input.hits, misses, hitRate, roi, roiExMax },
    recent: { settled: input.recentSettled, hits: input.recentHits, misses: recentMisses, hitRate: recentHitRate, roi: recentRoi },
    learnings: learnings.slice(0, 6), failurePatterns: failurePatterns.slice(0, 6), researchCandidates: dedupeCandidates(researchCandidates).slice(0, 6),
  };
  const errors = validateBuyLearningSummary(summary);
  if (errors.length) throw new Error(`buy learning summary invalid: ${errors.join("; ")}`);
  return summary;
}

export function unavailableBuyLearningSummary(generatedAt: string): BuyLearningSummary {
  return { schemaVersion: BUY_LEARNING_SCHEMA_VERSION, generatedAt, status: "NOT_AVAILABLE", source: "NOT_AVAILABLE", window: { from: null, to: null, label: "private outcome evidence unavailable" }, performance: { totalDecisions: null, settled: null, hits: null, misses: null, hitRate: null, roi: null, roiExMax: null }, recent: { settled: null, hits: null, misses: null, hitRate: null, roi: null }, learnings: [], failurePatterns: [], researchCandidates: [] };
}

export function validateBuyLearningSummary(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["summary must be object"];
  exactKeys(value, TOP_KEYS, "$", errors);
  if (value.schemaVersion !== BUY_LEARNING_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!isIso(value.generatedAt)) errors.push("invalid generatedAt");
  if (!["AVAILABLE", "NOT_AVAILABLE"].includes(String(value.status))) errors.push("invalid status");
  if (!["DECISION_HISTORY_DERIVED", "NOT_AVAILABLE"].includes(String(value.source))) errors.push("invalid source");

  if (!isRecord(value.window)) errors.push("invalid window"); else {
    exactKeys(value.window, WINDOW_KEYS, "$.window", errors);
    if (!(value.window.from === null || isDate(value.window.from)) || !(value.window.to === null || isDate(value.window.to)) || !isText(value.window.label)) errors.push("invalid window values");
  }
  if (!isRecord(value.performance)) errors.push("invalid performance"); else {
    exactKeys(value.performance, PERFORMANCE_KEYS, "$.performance", errors);
    for (const key of ["totalDecisions", "settled", "hits", "misses"] as const) if (!(value.performance[key] === null || isCount(value.performance[key]))) errors.push(`invalid performance.${key}`);
    for (const key of ["hitRate", "roi", "roiExMax"] as const) if (!(value.performance[key] === null || isMetric(value.performance[key]))) errors.push(`invalid performance.${key}`);
  }
  if (!isRecord(value.recent)) errors.push("invalid recent"); else {
    exactKeys(value.recent, RECENT_KEYS, "$.recent", errors);
    for (const key of ["settled", "hits", "misses"] as const) if (!(value.recent[key] === null || isCount(value.recent[key]))) errors.push(`invalid recent.${key}`);
    for (const key of ["hitRate", "roi"] as const) if (!(value.recent[key] === null || isMetric(value.recent[key]))) errors.push(`invalid recent.${key}`);
  }
  validateArray(value.learnings, 6, LEARNING_KEYS, "learnings", errors, (item) => isId(item.id) && ["INFO", "WATCH", "ACTION"].includes(String(item.severity)) && isText(item.title) && isText(item.summary) && isCount(item.evidenceCount));
  validateArray(value.failurePatterns, 6, FAILURE_KEYS, "failurePatterns", errors, (item) => isId(item.id) && isText(item.label) && isCount(item.count) && (item.share === null || isShare(item.share)));
  validateArray(value.researchCandidates, 6, CANDIDATE_KEYS, "researchCandidates", errors, (item) => isId(item.id) && isText(item.title) && isText(item.reason) && item.status === "PROPOSED" && item.productionChangeAllowed === false);

  if (value.status === "NOT_AVAILABLE") {
    if (value.source !== "NOT_AVAILABLE") errors.push("NOT_AVAILABLE source mismatch");
    if (isRecord(value.performance) && Object.values(value.performance).some((item) => item !== null)) errors.push("NOT_AVAILABLE performance must stay null");
    if (isRecord(value.recent) && Object.values(value.recent).some((item) => item !== null)) errors.push("NOT_AVAILABLE recent must stay null");
    if (Array.isArray(value.learnings) && value.learnings.length) errors.push("NOT_AVAILABLE learnings must be empty");
  } else if (value.source !== "DECISION_HISTORY_DERIVED") errors.push("AVAILABLE source mismatch");

  const serialized = JSON.stringify(value);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "/Users/", "/home/", "app_settings", "automation/requests", "holdoutRawKey"]) if (serialized.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`forbidden public field/value: ${forbidden}`);
  if (serialized.length > 24000) errors.push("summary too large");
  return errors;
}

function classifyHighEvLearning(input: BuyLearningAggregateInput): "UNIVERSAL" | "PENDING" | "COMPARABLE" | "NONE" | "LEGACY" {
  if (input.highEvSettled === undefined) return input.highEvMisses > 0 ? "LEGACY" : "NONE";
  if (input.highEvSettled === input.settled && input.settled > 0) return "UNIVERSAL";
  if (input.highEvMisses <= 0 || input.highEvSettled <= 0) return "NONE";
  const complement = input.settled - input.highEvSettled;
  if (input.highEvSettled >= HIGH_EV_COMPARISON_MIN_PER_SIDE && complement >= HIGH_EV_COMPARISON_MIN_PER_SIDE) return "COMPARABLE";
  return "PENDING";
}

function validateAggregateInput(input: BuyLearningAggregateInput) {
  if (input.avgDecisionEffectiveHitRate !== undefined && input.avgDecisionEffectiveHitRate !== null && (!Number.isFinite(input.avgDecisionEffectiveHitRate) || input.avgDecisionEffectiveHitRate < 0 || input.avgDecisionEffectiveHitRate > 1)) throw new Error("invalid avgDecisionEffectiveHitRate");
  if (input.highEvSettled !== undefined) {
    if (!Number.isInteger(input.highEvSettled) || input.highEvSettled < 0 || input.highEvSettled > input.settled) throw new Error("invalid highEvSettled");
    if (input.highEvMisses > input.highEvSettled) throw new Error("highEvMisses cannot exceed highEvSettled");
  }
}
function validateArray(value: unknown, max: number, keys: Set<string>, name: string, errors: string[], predicate: (item: Record<string, unknown>) => boolean) {
  if (!Array.isArray(value) || value.length > max) { errors.push(`invalid ${name}`); return; }
  value.forEach((raw, index) => { if (!isRecord(raw)) { errors.push(`invalid ${name}[${index}]`); return; } exactKeys(raw, keys, `$.${name}[${index}]`, errors); if (!predicate(raw)) errors.push(`invalid ${name}[${index}] values`); });
}
function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) { for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown key`); for (const key of allowed) if (!(key in value)) errors.push(`${path}.${key}: required`); }
function ratio(numerator: number, denominator: number): number | null { if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null; return Math.round((numerator / denominator) * 10000) / 10000; }
function dedupeCandidates(items: BuyLearningSummary["researchCandidates"]): BuyLearningSummary["researchCandidates"] { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function isDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [y,m,d]=value.split("-").map(Number); const date=new Date(Date.UTC(y,m-1,d)); return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d; }
function isText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 500; }
function isId(value: unknown): value is string { return typeof value === "string" && /^[A-Z0-9][A-Z0-9_.-]{1,79}$/.test(value); }
function isCount(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1000000000; }
function isMetric(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10000; }
function isShare(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
