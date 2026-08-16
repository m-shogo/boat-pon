import { validateBuyLearningSummary, type BuyLearningSummary } from "./buyLearningSummary";

export const OWNER_BUY_MARKET_HEALTH_SCHEMA_VERSION = "owner-buy-market-health-v1" as const;

export type OwnerBuyCalibrationClassification = "OVERCONFIDENT" | "UNDERCONFIDENT" | "WITHIN_5PT";
export type OwnerBuyCalibrationStability = "INSUFFICIENT_SUPPORT" | "STABLE_WITHIN_5PT" | "PERSISTENT_OVERCONFIDENCE" | "PERSISTENT_UNDERCONFIDENCE" | "CALIBRATION_REGIME_CHANGED";
export type OwnerBuyExpectedEvClassification = "BELOW_EXPECTED" | "CROSSES_EXPECTED" | "ABOVE_EXPECTED";

export type OwnerBuyMarketHealth = {
  schemaVersion: typeof OWNER_BUY_MARKET_HEALTH_SCHEMA_VERSION;
  generatedAt: string;
  status: "AVAILABLE" | "NOT_AVAILABLE";
  probability: null | {
    settled: number;
    decisionEffectiveHitRate: number;
    observedHitRate: number;
    calibrationBias: number;
    classification: OwnerBuyCalibrationClassification;
    stability: OwnerBuyCalibrationStability;
    featureAdjustedHitRate: number;
    featureToDecisionRetention: number;
  };
  evRealization: null | {
    performance: OwnerBuyEvRealizationScope;
    recent: OwnerBuyEvRealizationScope;
  };
  priceReadiness: null | {
    minimumHits: number;
    performance: OwnerBuyPriceReadinessScope;
    recent: OwnerBuyPriceReadinessScope;
  };
  productionChangeAllowed: false;
};

export type OwnerBuyEvRealizationScope = {
  trials: number;
  averageStoredEv: number;
  realizedRoi: number;
  realizedToExpectedRatio: number;
  classification: OwnerBuyExpectedEvClassification;
};

export type OwnerBuyPriceReadinessScope = {
  status: "INSUFFICIENT_HIT_SUPPORT" | "AVAILABLE";
  hits: number;
  minimumHits: number;
  missingHits: number;
};

type BuildInput = {
  generatedAt: string;
  buyLearning: unknown;
  calibration: unknown;
  roiUncertainty: unknown;
};

const TOP_KEYS = new Set(["schemaVersion", "generatedAt", "status", "probability", "evRealization", "priceReadiness", "productionChangeAllowed"]);
const PROBABILITY_KEYS = new Set(["settled", "decisionEffectiveHitRate", "observedHitRate", "calibrationBias", "classification", "stability", "featureAdjustedHitRate", "featureToDecisionRetention"]);
const EV_KEYS = new Set(["performance", "recent"]);
const EV_SCOPE_KEYS = new Set(["trials", "averageStoredEv", "realizedRoi", "realizedToExpectedRatio", "classification"]);
const PRICE_KEYS = new Set(["minimumHits", "performance", "recent"]);
const PRICE_SCOPE_KEYS = new Set(["status", "hits", "minimumHits", "missingHits"]);
const CALIBRATION_CLASSES = new Set(["OVERCONFIDENT", "UNDERCONFIDENT", "WITHIN_5PT"]);
const CALIBRATION_STABILITIES = new Set(["INSUFFICIENT_SUPPORT", "STABLE_WITHIN_5PT", "PERSISTENT_OVERCONFIDENCE", "PERSISTENT_UNDERCONFIDENCE", "CALIBRATION_REGIME_CHANGED"]);
const EV_CLASSES = new Set(["BELOW_EXPECTED", "CROSSES_EXPECTED", "ABOVE_EXPECTED"]);
const PRICE_STATUSES = new Set(["INSUFFICIENT_HIT_SUPPORT", "AVAILABLE"]);
const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function unavailableOwnerBuyMarketHealth(generatedAt: string): OwnerBuyMarketHealth {
  return {
    schemaVersion: OWNER_BUY_MARKET_HEALTH_SCHEMA_VERSION,
    generatedAt,
    status: "NOT_AVAILABLE",
    probability: null,
    evRealization: null,
    priceReadiness: null,
    productionChangeAllowed: false,
  };
}

export function buildOwnerBuyMarketHealth(input: BuildInput): OwnerBuyMarketHealth {
  if (!isIso(input.generatedAt)) throw new Error("invalid Owner BUY market health generatedAt");
  const learning = parseLearning(input.buyLearning);
  if (learning.status !== "AVAILABLE") return unavailableOwnerBuyMarketHealth(input.generatedAt);
  const settled = requiredCount(learning.performance.settled, "settled");
  const hits = requiredCount(learning.performance.hits, "hits");
  const hitRate = requiredNumber(learning.performance.hitRate, "hitRate");
  const roi = requiredNumber(learning.performance.roi, "roi");
  const recentSettled = requiredCount(learning.recent.settled, "recent settled");
  const recentHits = requiredCount(learning.recent.hits, "recent hits");
  const recentRoi = requiredNumber(learning.recent.roi, "recent roi");

  const probability = parseProbability(input.calibration, { settled, hits, hitRate });
  const { evRealization, priceReadiness } = parseEconomicHealth(input.roiUncertainty, {
    settled,
    hits,
    roi,
    recentSettled,
    recentHits,
    recentRoi,
  });

  const value: OwnerBuyMarketHealth = {
    schemaVersion: OWNER_BUY_MARKET_HEALTH_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: "AVAILABLE",
    probability,
    evRealization,
    priceReadiness,
    productionChangeAllowed: false,
  };
  const errors = validateOwnerBuyMarketHealth(value);
  if (errors.length) throw new Error(`Owner BUY market health invalid: ${errors.join("; ")}`);
  return value;
}

export function validateOwnerBuyMarketHealth(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["market health must be object"];
  exactKeys(value, TOP_KEYS, "$", errors);
  if (value.schemaVersion !== OWNER_BUY_MARKET_HEALTH_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!isIso(value.generatedAt)) errors.push("invalid generatedAt");
  if (!["AVAILABLE", "NOT_AVAILABLE"].includes(String(value.status))) errors.push("invalid status");
  if (value.productionChangeAllowed !== false) errors.push("productionChangeAllowed must be false");
  if (value.status === "NOT_AVAILABLE") {
    if (value.probability !== null || value.evRealization !== null || value.priceReadiness !== null) errors.push("NOT_AVAILABLE market health must keep evidence null");
  } else {
    validateProbability(value.probability, errors);
    validateEv(value.evRealization, errors);
    validatePrice(value.priceReadiness, errors);
  }
  const serialized = JSON.stringify(value);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "venue", "/Users/", "/home/", "app_settings", "automation/requests", "holdoutRawKey"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`private marker forbidden: ${forbidden}`);
  }
  if (serialized.length > 12000) errors.push("market health too large");
  return errors;
}

function parseProbability(value: unknown, expected: { settled: number; hits: number; hitRate: number }): NonNullable<OwnerBuyMarketHealth["probability"]> {
  if (!isRecord(value) || value.schemaVersion !== "buy-probability-calibration-public-v4" || value.productionChangeAllowed !== false) throw new Error("invalid BUY probability calibration source");
  if (!isRecord(value.overall) || value.overall.status !== "AVAILABLE" || value.overall.settled !== expected.settled || !isRecord(value.overall.metrics)) throw new Error("BUY probability overall cohort mismatch");
  const metrics = value.overall.metrics;
  if (metrics.observedHits !== expected.hits || !sameMetric(metrics.observedHitRate, expected.hitRate)) throw new Error("BUY probability observed outcome mismatch");
  for (const key of ["averagePredictedHitRate", "observedHitRate", "calibrationBias"] as const) if (!isFiniteNumber(metrics[key])) throw new Error(`invalid BUY probability ${key}`);
  if (!CALIBRATION_CLASSES.has(String(metrics.classification))) throw new Error("invalid BUY probability classification");
  if (!isRecord(value.stability) || value.stability.totalSettled !== expected.settled || !CALIBRATION_STABILITIES.has(String(value.stability.status)) || value.stability.productionChangeAllowed !== false) throw new Error("invalid BUY probability stability");
  if (!isRecord(value.probabilityPipeline) || !isRecord(value.probabilityPipeline.overall)) throw new Error("BUY probability pipeline unavailable");
  const pipeline = value.probabilityPipeline.overall;
  if (pipeline.settled !== expected.settled || !isRecord(pipeline.stages) || !isRecord(pipeline.transitions)) throw new Error("BUY probability pipeline cohort mismatch");
  const feature = pipeline.stages.featureAdjusted;
  const effective = pipeline.stages.decisionEffective;
  const transition = pipeline.transitions.featureAdjustedToDecisionEffective;
  if (!isRecord(feature) || !isRecord(effective) || !isRecord(transition)) throw new Error("BUY probability pipeline stages unavailable");
  if (!isProbability(feature.averageProbability) || !isProbability(effective.averageProbability) || !isNonNegativeFinite(transition.retentionRatio)) throw new Error("invalid BUY probability pipeline aggregate");
  if (!sameMetric(effective.averageProbability, Number(metrics.averagePredictedHitRate))) throw new Error("BUY decision-effective probability mismatch");
  if (!isCount(effective.eligible) || effective.eligible !== expected.settled || effective.missing !== 0 || effective.coverage !== 1) throw new Error("BUY decision-effective probability coverage incomplete");
  const expectedRetention = Number(feature.averageProbability) > 0 ? Number(effective.averageProbability) / Number(feature.averageProbability) : null;
  if (expectedRetention === null || !sameRatio(transition.retentionRatio, expectedRetention)) throw new Error("BUY probability retention mismatch");
  return {
    settled: expected.settled,
    decisionEffectiveHitRate: round4(Number(metrics.averagePredictedHitRate)),
    observedHitRate: round4(Number(metrics.observedHitRate)),
    calibrationBias: round4(Number(metrics.calibrationBias)),
    classification: String(metrics.classification) as OwnerBuyCalibrationClassification,
    stability: String(value.stability.status) as OwnerBuyCalibrationStability,
    featureAdjustedHitRate: round4(Number(feature.averageProbability)),
    featureToDecisionRetention: round4(Number(transition.retentionRatio)),
  };
}

function parseEconomicHealth(value: unknown, expected: { settled: number; hits: number; roi: number; recentSettled: number; recentHits: number; recentRoi: number }): { evRealization: NonNullable<OwnerBuyMarketHealth["evRealization"]>; priceReadiness: NonNullable<OwnerBuyMarketHealth["priceReadiness"]> } {
  if (!isRecord(value) || value.schemaVersion !== "buy-roi-uncertainty-public-v1" || value.productionChangeAllowed !== false) throw new Error("invalid BUY ROI source for market health");
  if (!isRecord(value.performance) || !isRecord(value.recent) || !isRecord(value.expectationRealization) || !isRecord(value.priceRealization)) throw new Error("BUY ROI market health source incomplete");
  const performanceInterval = parseRoiIntervalPoint(value.performance, expected.settled, expected.roi, "performance");
  const recentInterval = parseRoiIntervalPoint(value.recent, expected.recentSettled, expected.recentRoi, "recent");
  const expectation = value.expectationRealization;
  const evPerformance = parseEvScope(expectation.performance, { trials: expected.settled, roi: expected.roi, interval: performanceInterval }, "performance");
  const evRecent = parseEvScope(expectation.recent, { trials: expected.recentSettled, roi: expected.recentRoi, interval: recentInterval }, "recent");
  const price = value.priceRealization;
  if (!isCount(price.minimumHits) || Number(price.minimumHits) < 5) throw new Error("BUY price readiness minimumHits must be at least 5");
  const minimumHits = Number(price.minimumHits);
  const pricePerformance = parsePriceScope(price.performance, expected.hits, minimumHits, "performance");
  const priceRecent = parsePriceScope(price.recent, expected.recentHits, minimumHits, "recent");
  return {
    evRealization: { performance: evPerformance, recent: evRecent },
    priceReadiness: { minimumHits, performance: pricePerformance, recent: priceRecent },
  };
}

function parseEvScope(value: unknown, expected: { trials: number; roi: number; interval: { lower: number; upper: number } }, label: string): OwnerBuyEvRealizationScope {
  if (!isRecord(value) || value.status !== "AVAILABLE" || value.trials !== expected.trials || value.expectedEvEligible !== expected.trials || value.missingExpectedEv !== 0) throw new Error(`BUY EV realization ${label} support mismatch`);
  if (!isNonNegativeFinite(value.averageStoredEv) || Number(value.averageStoredEv) <= 0 || !sameMetric(value.realizedRoi, expected.roi) || !isNonNegativeFinite(value.realizedToExpectedRatio)) throw new Error(`invalid BUY EV realization ${label}`);
  if (!EV_CLASSES.has(String(value.classification))) throw new Error(`invalid BUY EV realization ${label} classification`);
  const averageStoredEv = Number(value.averageStoredEv);
  const expectedRatio = expected.roi / averageStoredEv;
  if (!sameMetric(value.realizedToExpectedRatio, expectedRatio)) throw new Error(`BUY EV realization ${label} ratio mismatch`);
  const classification = expected.interval.upper < averageStoredEv ? "BELOW_EXPECTED" : expected.interval.lower > averageStoredEv ? "ABOVE_EXPECTED" : "CROSSES_EXPECTED";
  if (value.classification !== classification) throw new Error(`BUY EV realization ${label} interval classification mismatch`);
  return {
    trials: expected.trials,
    averageStoredEv: round4(averageStoredEv),
    realizedRoi: round4(expected.roi),
    realizedToExpectedRatio: round4(Number(value.realizedToExpectedRatio)),
    classification,
  };
}

function parsePriceScope(value: unknown, expectedHits: number, minimumHits: number, label: string): OwnerBuyPriceReadinessScope {
  if (!isRecord(value) || !PRICE_STATUSES.has(String(value.status)) || value.hits !== expectedHits || value.minimumHits !== minimumHits) throw new Error(`BUY price readiness ${label} count mismatch`);
  const missingHits = Math.max(0, minimumHits - expectedHits);
  if (value.missingHits !== missingHits) throw new Error(`BUY price readiness ${label} missingHits mismatch`);
  const shouldBeAvailable = expectedHits >= minimumHits;
  if (shouldBeAvailable !== (value.status === "AVAILABLE")) throw new Error(`BUY price readiness ${label} status mismatch`);
  if (!shouldBeAvailable) {
    for (const key of ["averageDecisionPriceProxy", "averageRealizedPriceProxy", "realizedToDecisionRatio", "averagePriceGap"]) if (value[key] !== null) throw new Error(`BUY price readiness ${label} leaked value below support floor`);
  }
  return { status: String(value.status) as OwnerBuyPriceReadinessScope["status"], hits: expectedHits, minimumHits, missingHits };
}

function parseRoiIntervalPoint(value: unknown, trials: number, roi: number, label: string): { lower: number; upper: number } {
  if (!isRecord(value) || value.status !== "AVAILABLE" || value.trials !== trials || !isRecord(value.interval)) throw new Error(`BUY ROI ${label} unavailable for market health`);
  if (!sameMetric(value.interval.pointEstimate, roi) || !isNonNegativeFinite(value.interval.lower) || !isNonNegativeFinite(value.interval.upper) || Number(value.interval.lower) > roi || Number(value.interval.upper) < roi) throw new Error(`BUY ROI ${label} interval mismatch for market health`);
  return { lower: Number(value.interval.lower), upper: Number(value.interval.upper) };
}

function parseLearning(value: unknown): BuyLearningSummary {
  const errors = validateBuyLearningSummary(value);
  if (errors.length) throw new Error(`BUY learning invalid for market health: ${errors.join("; ")}`);
  return value as BuyLearningSummary;
}

function validateProbability(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid probability"), undefined;
  exactKeys(value, PROBABILITY_KEYS, "$.probability", errors);
  if (!isCount(value.settled)) errors.push("invalid probability.settled");
  for (const key of ["decisionEffectiveHitRate", "observedHitRate", "featureAdjustedHitRate", "featureToDecisionRetention"] as const) if (!isNonNegativeFinite(value[key])) errors.push(`invalid probability.${key}`);
  if (!isFiniteNumber(value.calibrationBias)) errors.push("invalid probability.calibrationBias");
  if (!CALIBRATION_CLASSES.has(String(value.classification))) errors.push("invalid probability.classification");
  if (!CALIBRATION_STABILITIES.has(String(value.stability))) errors.push("invalid probability.stability");
}

function validateEv(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid evRealization"), undefined;
  exactKeys(value, EV_KEYS, "$.evRealization", errors);
  validateEvScope(value.performance, "$.evRealization.performance", errors);
  validateEvScope(value.recent, "$.evRealization.recent", errors);
}
function validateEvScope(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`invalid ${path}`), undefined;
  exactKeys(value, EV_SCOPE_KEYS, path, errors);
  if (!isCount(value.trials)) errors.push(`invalid ${path}.trials`);
  for (const key of ["averageStoredEv", "realizedRoi", "realizedToExpectedRatio"] as const) if (!isNonNegativeFinite(value[key])) errors.push(`invalid ${path}.${key}`);
  if (!EV_CLASSES.has(String(value.classification))) errors.push(`invalid ${path}.classification`);
}
function validatePrice(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid priceReadiness"), undefined;
  exactKeys(value, PRICE_KEYS, "$.priceReadiness", errors);
  if (!isCount(value.minimumHits) || Number(value.minimumHits) < 5) errors.push("invalid priceReadiness.minimumHits");
  validatePriceScope(value.performance, "$.priceReadiness.performance", errors);
  validatePriceScope(value.recent, "$.priceReadiness.recent", errors);
}
function validatePriceScope(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`invalid ${path}`), undefined;
  exactKeys(value, PRICE_SCOPE_KEYS, path, errors);
  if (!PRICE_STATUSES.has(String(value.status))) errors.push(`invalid ${path}.status`);
  for (const key of ["hits", "minimumHits", "missingHits"] as const) if (!isCount(value[key])) errors.push(`invalid ${path}.${key}`);
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) { for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown key`); for (const key of allowed) if (!(key in value)) errors.push(`${path}.${key}: required`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCount(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isNonNegativeFinite(value: unknown): value is number { return isFiniteNumber(value) && value >= 0; }
function isProbability(value: unknown): value is number { return isNonNegativeFinite(value) && value <= 1; }
function isIso(value: unknown): value is string { return typeof value === "string" && RFC3339_TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value)); }
function requiredCount(value: number | null, label: string): number { if (!isCount(value)) throw new Error(`BUY learning missing ${label}`); return value; }
function requiredNumber(value: number | null, label: string): number { if (!isFiniteNumber(value)) throw new Error(`BUY learning missing ${label}`); return value; }
function sameMetric(left: unknown, right: number): boolean { return isFiniteNumber(left) && Math.abs(left - right) <= 0.00015; }
function sameRatio(left: unknown, right: number): boolean { return isFiniteNumber(left) && Math.abs(left - right) <= 0.002; }
function round4(value: number): number { return Math.round(value * 10000) / 10000; }
