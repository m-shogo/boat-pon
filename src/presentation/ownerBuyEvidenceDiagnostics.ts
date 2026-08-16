import { validateBuyLearningSummary, type BuyLearningSummary } from "./buyLearningSummary";
import { validateBuyTailPublicSignal } from "./buyTailLearningMerge";

export const OWNER_BUY_EVIDENCE_SCHEMA_VERSION = "owner-buy-evidence-diagnostics-v3" as const;

export type OwnerBuyWilsonInterval = {
  confidenceLevel: 0.95;
  method: "WILSON_SCORE";
  trials: number;
  successes: number;
  pointEstimate: number | null;
  lower: number | null;
  upper: number | null;
  width: number | null;
};

export type OwnerBuyRoiBootstrapInterval = {
  confidenceLevel: 0.95;
  method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP";
  trials: number;
  iterations: number;
  pointEstimate: number;
  lower: number;
  upper: number;
  width: number;
  breakEven: 1;
  classification: "BELOW_BREAK_EVEN" | "CROSSES_BREAK_EVEN" | "ABOVE_BREAK_EVEN";
};

export type OwnerBuyRoiScope = {
  status: "AVAILABLE" | "INSUFFICIENT_SUPPORT";
  trials: number;
  minimumTrials: number;
  missingTrials: number;
  interval: OwnerBuyRoiBootstrapInterval | null;
};

export type OwnerBuyEvidenceDiagnostics = {
  schemaVersion: typeof OWNER_BUY_EVIDENCE_SCHEMA_VERSION;
  generatedAt: string;
  status: "AVAILABLE" | "NOT_AVAILABLE";
  patternSupport: null | {
    status: "INSUFFICIENT_GLOBAL_SUPPORT" | "NO_SUPPORTED_CONTRAST" | "SUPPORTED_CONTRASTS";
    noSignalReason: "INSUFFICIENT_GLOBAL_SUPPORT" | "NO_SUPPORTED_CONTRAST" | "NO_MATERIAL_ROI_CONTRAST" | null;
    analyzedSettled: number;
    minimumSettledPerSide: number;
    minimumTotalSettledForAnyContrast: number;
    globalAdditionalSettledForAnyContrast: number;
    validSegmentCount: number;
    segmentSideEligibleCount: number;
    universalEligibleSegmentCount: number;
    closestObservedComplementSettled: number | null;
    minimumObservedComplementShortfall: number | null;
    contrastBlocker: "NO_ELIGIBLE_SEGMENT" | "UNIVERSAL_SEGMENT_COVERAGE" | "COMPLEMENT_SUPPORT_SHORTFALL" | null;
    supportedContrastCount: number;
    supportedDimensionCount: number;
    patternSignalCount: number;
  };
  hitRateUncertainty: null | {
    status: "AVAILABLE";
    performance: OwnerBuyWilsonInterval;
    recent: OwnerBuyWilsonInterval;
  };
  roiUncertainty: null | {
    status: "AVAILABLE" | "INSUFFICIENT_SUPPORT";
    minimumTrials: number;
    performance: OwnerBuyRoiScope;
    recent: OwnerBuyRoiScope;
  };
  tailStability: null | {
    status: "INSUFFICIENT_SUPPORT" | "PERSISTENT_TAIL_DEPENDENCE" | "RECENT_TAIL_DEPENDENCE" | "PRIOR_TAIL_DEPENDENCE" | "NO_TAIL_DEPENDENCE_SIGNAL";
    windowSize: number;
    minimumTailGap: number;
    totalSettled: number;
    recentSettled: number;
    priorSettled: number;
    missingSettledToCompare: number;
    recentTailGap: number | null;
    priorTailGap: number | null;
  };
  productionChangeAllowed: false;
};

type BuildInput = {
  generatedAt: string;
  buyLearning: unknown;
  patterns: unknown;
  tail: unknown;
  uncertainty: unknown;
  roiUncertainty: unknown;
};

const TOP_KEYS = new Set(["schemaVersion", "generatedAt", "status", "patternSupport", "hitRateUncertainty", "roiUncertainty", "tailStability", "productionChangeAllowed"]);
const PATTERN_KEYS = new Set(["status", "noSignalReason", "analyzedSettled", "minimumSettledPerSide", "minimumTotalSettledForAnyContrast", "globalAdditionalSettledForAnyContrast", "validSegmentCount", "segmentSideEligibleCount", "universalEligibleSegmentCount", "closestObservedComplementSettled", "minimumObservedComplementShortfall", "contrastBlocker", "supportedContrastCount", "supportedDimensionCount", "patternSignalCount"]);
const HIT_RATE_KEYS = new Set(["status", "performance", "recent"]);
const INTERVAL_KEYS = new Set(["confidenceLevel", "method", "trials", "successes", "pointEstimate", "lower", "upper", "width"]);
const ROI_KEYS = new Set(["status", "minimumTrials", "performance", "recent"]);
const ROI_SCOPE_KEYS = new Set(["status", "trials", "minimumTrials", "missingTrials", "interval"]);
const ROI_INTERVAL_KEYS = new Set(["confidenceLevel", "method", "trials", "iterations", "pointEstimate", "lower", "upper", "width", "breakEven", "classification"]);
const TAIL_KEYS = new Set(["status", "windowSize", "minimumTailGap", "totalSettled", "recentSettled", "priorSettled", "missingSettledToCompare", "recentTailGap", "priorTailGap"]);
const PATTERN_STATUSES = new Set(["INSUFFICIENT_GLOBAL_SUPPORT", "NO_SUPPORTED_CONTRAST", "SUPPORTED_CONTRASTS"]);
const NO_SIGNAL_REASONS = new Set(["INSUFFICIENT_GLOBAL_SUPPORT", "NO_SUPPORTED_CONTRAST", "NO_MATERIAL_ROI_CONTRAST"]);
const PATTERN_BLOCKERS = new Set(["NO_ELIGIBLE_SEGMENT", "UNIVERSAL_SEGMENT_COVERAGE", "COMPLEMENT_SUPPORT_SHORTFALL"]);
const ROI_SCOPE_STATUSES = new Set(["AVAILABLE", "INSUFFICIENT_SUPPORT"]);
const ROI_CLASSIFICATIONS = new Set(["BELOW_BREAK_EVEN", "CROSSES_BREAK_EVEN", "ABOVE_BREAK_EVEN"]);
const TAIL_STATUSES = new Set(["INSUFFICIENT_SUPPORT", "PERSISTENT_TAIL_DEPENDENCE", "RECENT_TAIL_DEPENDENCE", "PRIOR_TAIL_DEPENDENCE", "NO_TAIL_DEPENDENCE_SIGNAL"]);
const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function unavailableOwnerBuyEvidenceDiagnostics(generatedAt: string): OwnerBuyEvidenceDiagnostics {
  return {
    schemaVersion: OWNER_BUY_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    status: "NOT_AVAILABLE",
    patternSupport: null,
    hitRateUncertainty: null,
    roiUncertainty: null,
    tailStability: null,
    productionChangeAllowed: false,
  };
}

export function buildOwnerBuyEvidenceDiagnostics(input: BuildInput): OwnerBuyEvidenceDiagnostics {
  if (!isIso(input.generatedAt)) throw new Error("invalid Owner BUY evidence generatedAt");
  const buyLearning = parseBuyLearning(input.buyLearning);
  if (buyLearning.status !== "AVAILABLE") return unavailableOwnerBuyEvidenceDiagnostics(input.generatedAt);
  const settled = buyLearning.performance.settled;
  const hits = buyLearning.performance.hits;
  const roi = buyLearning.performance.roi;
  const recentSettled = buyLearning.recent.settled;
  const recentHits = buyLearning.recent.hits;
  const recentRoi = buyLearning.recent.roi;
  if (settled === null || hits === null || roi === null || recentSettled === null || recentHits === null) throw new Error("AVAILABLE BUY learning must include settled metrics");

  const patternSupport = parsePatternSupport(input.patterns, settled);
  const hitRateUncertainty = parseHitRateUncertainty(input.uncertainty, { settled, hits, recentSettled, recentHits });
  const roiUncertainty = parseRoiUncertainty(input.roiUncertainty, { settled, roi, recentSettled, recentRoi });
  const tail = validateBuyTailPublicSignal(input.tail);
  if (tail.totalSettled !== settled) throw new Error("BUY tail/dashboard settled count mismatch");

  const diagnostics: OwnerBuyEvidenceDiagnostics = {
    schemaVersion: OWNER_BUY_EVIDENCE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: "AVAILABLE",
    patternSupport,
    hitRateUncertainty,
    roiUncertainty,
    tailStability: {
      status: tail.status,
      windowSize: tail.windowSize,
      minimumTailGap: tail.minimumTailGap,
      totalSettled: tail.totalSettled,
      recentSettled: tail.support.recentSettled,
      priorSettled: tail.support.priorSettled,
      missingSettledToCompare: tail.support.missingSettledToCompare,
      recentTailGap: tail.recent.tailGap,
      priorTailGap: tail.prior.tailGap,
    },
    productionChangeAllowed: false,
  };
  const errors = validateOwnerBuyEvidenceDiagnostics(diagnostics);
  if (errors.length) throw new Error(`Owner BUY evidence diagnostics invalid: ${errors.join("; ")}`);
  return diagnostics;
}

export function validateOwnerBuyEvidenceDiagnostics(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["diagnostics must be object"];
  exactKeys(value, TOP_KEYS, "$", errors);
  if (value.schemaVersion !== OWNER_BUY_EVIDENCE_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!isIso(value.generatedAt)) errors.push("invalid generatedAt");
  if (!["AVAILABLE", "NOT_AVAILABLE"].includes(String(value.status))) errors.push("invalid status");
  if (value.productionChangeAllowed !== false) errors.push("productionChangeAllowed must be false");

  if (value.status === "NOT_AVAILABLE") {
    if (value.patternSupport !== null || value.hitRateUncertainty !== null || value.roiUncertainty !== null || value.tailStability !== null) errors.push("NOT_AVAILABLE diagnostics must keep evidence null");
  } else {
    validatePatternProjection(value.patternSupport, errors);
    validateHitRateProjection(value.hitRateUncertainty, errors);
    validateRoiProjection(value.roiUncertainty, errors);
    validateTailProjection(value.tailStability, errors);
  }

  const serialized = JSON.stringify(value);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "/Users/", "/home/", "app_settings", "automation/requests", "holdoutRawKey"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`private marker forbidden: ${forbidden}`);
  }
  if (serialized.length > 20000) errors.push("diagnostics too large");
  return errors;
}

function parseBuyLearning(value: unknown): BuyLearningSummary {
  const errors = validateBuyLearningSummary(value);
  if (errors.length) throw new Error(`BUY learning invalid for dashboard evidence: ${errors.join("; ")}`);
  return value as BuyLearningSummary;
}

function parsePatternSupport(value: unknown, settled: number): NonNullable<OwnerBuyEvidenceDiagnostics["patternSupport"]> {
  if (!isRecord(value) || value.schemaVersion !== "buy-outcome-pattern-public-v1" || value.productionChangeAllowed !== false) throw new Error("invalid BUY pattern public source");
  if (!isCount(value.analyzedSettled) || value.analyzedSettled !== settled) throw new Error("BUY pattern/dashboard settled count mismatch");
  if (!isRecord(value.support)) throw new Error("BUY pattern support unavailable");
  const support = value.support;
  const status = String(support.status);
  if (!PATTERN_STATUSES.has(status)) throw new Error("invalid BUY pattern support status");
  for (const key of ["minimumSettledPerSide", "minimumTotalSettledForAnyContrast", "globalAdditionalSettledForAnyContrast", "validSegmentCount", "segmentSideEligibleCount", "universalEligibleSegmentCount", "supportedContrastCount", "supportedDimensionCount"] as const) {
    if (!isCount(support[key])) throw new Error(`invalid BUY pattern support ${key}`);
  }
  const minimumSettledPerSide = Number(support.minimumSettledPerSide);
  const minimumTotalSettledForAnyContrast = Number(support.minimumTotalSettledForAnyContrast);
  const globalAdditionalSettledForAnyContrast = Number(support.globalAdditionalSettledForAnyContrast);
  const validSegmentCount = Number(support.validSegmentCount);
  const segmentSideEligibleCount = Number(support.segmentSideEligibleCount);
  const universalEligibleSegmentCount = Number(support.universalEligibleSegmentCount);
  const supportedContrastCount = Number(support.supportedContrastCount);
  const supportedDimensionCount = Number(support.supportedDimensionCount);
  const closestObservedComplementSettled = nullableCount(support.closestObservedComplementSettled, "closestObservedComplementSettled");
  const minimumObservedComplementShortfall = nullableCount(support.minimumObservedComplementShortfall, "minimumObservedComplementShortfall");
  const contrastBlocker = support.contrastBlocker === null ? null : String(support.contrastBlocker);

  if (minimumSettledPerSide < 1 || minimumTotalSettledForAnyContrast !== minimumSettledPerSide * 2) throw new Error("invalid BUY pattern two-sided support floor");
  if (globalAdditionalSettledForAnyContrast !== Math.max(0, minimumTotalSettledForAnyContrast - settled)) throw new Error("BUY pattern global support delta mismatch");
  if (segmentSideEligibleCount > validSegmentCount || universalEligibleSegmentCount > segmentSideEligibleCount || supportedContrastCount > segmentSideEligibleCount || supportedDimensionCount > 6) throw new Error("BUY pattern support counts inconsistent");
  if ((segmentSideEligibleCount === 0) !== (closestObservedComplementSettled === null || minimumObservedComplementShortfall === null)) throw new Error("BUY pattern complement readiness nullability mismatch");
  if (closestObservedComplementSettled !== null && minimumObservedComplementShortfall !== Math.max(0, minimumSettledPerSide - closestObservedComplementSettled)) throw new Error("BUY pattern complement shortfall mismatch");
  if (contrastBlocker !== null && !PATTERN_BLOCKERS.has(contrastBlocker)) throw new Error("invalid BUY pattern contrast blocker");
  if (supportedContrastCount > 0) {
    if (contrastBlocker !== null || minimumObservedComplementShortfall !== 0) throw new Error("supported BUY contrast blocker mismatch");
  } else if (segmentSideEligibleCount === 0) {
    if (contrastBlocker !== "NO_ELIGIBLE_SEGMENT") throw new Error("NO_ELIGIBLE_SEGMENT blocker mismatch");
  } else if (universalEligibleSegmentCount === segmentSideEligibleCount) {
    if (contrastBlocker !== "UNIVERSAL_SEGMENT_COVERAGE" || closestObservedComplementSettled !== 0) throw new Error("UNIVERSAL_SEGMENT_COVERAGE blocker mismatch");
  } else if (contrastBlocker !== "COMPLEMENT_SUPPORT_SHORTFALL" || minimumObservedComplementShortfall === null || minimumObservedComplementShortfall <= 0) {
    throw new Error("COMPLEMENT_SUPPORT_SHORTFALL blocker mismatch");
  }

  const signals = Array.isArray(value.signals) ? value.signals : [];
  const noSignalReason = value.noSignalReason === null ? null : String(value.noSignalReason);
  if (noSignalReason !== null && !NO_SIGNAL_REASONS.has(noSignalReason)) throw new Error("invalid BUY pattern noSignalReason");
  if (signals.length > 0 && noSignalReason !== null) throw new Error("BUY pattern signal/reason mismatch");
  if (signals.length === 0 && noSignalReason === null) throw new Error("BUY pattern missing no-signal reason");
  return {
    status: status as NonNullable<OwnerBuyEvidenceDiagnostics["patternSupport"]>["status"],
    noSignalReason: noSignalReason as NonNullable<OwnerBuyEvidenceDiagnostics["patternSupport"]>["noSignalReason"],
    analyzedSettled: settled,
    minimumSettledPerSide,
    minimumTotalSettledForAnyContrast,
    globalAdditionalSettledForAnyContrast,
    validSegmentCount,
    segmentSideEligibleCount,
    universalEligibleSegmentCount,
    closestObservedComplementSettled,
    minimumObservedComplementShortfall,
    contrastBlocker: contrastBlocker as NonNullable<OwnerBuyEvidenceDiagnostics["patternSupport"]>["contrastBlocker"],
    supportedContrastCount,
    supportedDimensionCount,
    patternSignalCount: signals.length,
  };
}

function parseHitRateUncertainty(value: unknown, counts: { settled: number; hits: number; recentSettled: number; recentHits: number }): NonNullable<OwnerBuyEvidenceDiagnostics["hitRateUncertainty"]> {
  if (!isRecord(value) || value.schemaVersion !== "buy-hit-rate-uncertainty-public-v1" || value.status !== "AVAILABLE" || value.productionChangeAllowed !== false) throw new Error("invalid BUY hit-rate uncertainty source");
  const performance = parseWilson(value.performance, counts.settled, counts.hits, "performance");
  const recent = parseWilson(value.recent, counts.recentSettled, counts.recentHits, "recent");
  return { status: "AVAILABLE", performance, recent };
}

function parseWilson(value: unknown, trials: number, successes: number, label: string): OwnerBuyWilsonInterval {
  if (!isRecord(value)) throw new Error(`invalid BUY Wilson ${label}`);
  if (value.confidenceLevel !== 0.95 || value.method !== "WILSON_SCORE" || value.trials !== trials || value.successes !== successes) throw new Error(`BUY Wilson ${label} count mismatch`);
  for (const key of ["pointEstimate", "lower", "upper", "width"] as const) if (!(value[key] === null || isProbability(value[key]))) throw new Error(`invalid BUY Wilson ${label}.${key}`);
  if (trials > 0) {
    if ([value.pointEstimate, value.lower, value.upper, value.width].some((item) => item === null)) throw new Error(`BUY Wilson ${label} unexpectedly null`);
    if (Number(value.lower) > Number(value.pointEstimate) || Number(value.pointEstimate) > Number(value.upper)) throw new Error(`BUY Wilson ${label} bounds inconsistent`);
  }
  return value as unknown as OwnerBuyWilsonInterval;
}

function parseRoiUncertainty(
  value: unknown,
  expected: { settled: number; roi: number; recentSettled: number; recentRoi: number | null },
): NonNullable<OwnerBuyEvidenceDiagnostics["roiUncertainty"]> {
  if (!isRecord(value) || value.schemaVersion !== "buy-roi-uncertainty-public-v1" || value.productionChangeAllowed !== false) throw new Error("invalid BUY ROI uncertainty source");
  if (!isCount(value.minimumTrials) || Number(value.minimumTrials) < 20) throw new Error("invalid BUY ROI uncertainty minimumTrials");
  const minimumTrials = Number(value.minimumTrials);
  const performance = parseRoiScope(value.performance, expected.settled, expected.roi, minimumTrials, "performance");
  const recent = parseRoiScope(value.recent, expected.recentSettled, expected.recentRoi, minimumTrials, "recent");
  const expectedStatus = performance.status === "AVAILABLE" ? "AVAILABLE" : "INSUFFICIENT_SUPPORT";
  if (value.status !== expectedStatus) throw new Error("BUY ROI uncertainty top-level status mismatch");
  return { status: expectedStatus, minimumTrials, performance, recent };
}

function parseRoiScope(value: unknown, trials: number, pointEstimate: number | null, minimumTrials: number, label: string): OwnerBuyRoiScope {
  if (!isRecord(value)) throw new Error(`invalid BUY ROI ${label} scope`);
  exactKeys(value, ROI_SCOPE_KEYS, `$.roiUncertainty.${label}`, []);
  if (!ROI_SCOPE_STATUSES.has(String(value.status)) || value.trials !== trials || value.minimumTrials !== minimumTrials) throw new Error(`BUY ROI ${label} support mismatch`);
  const missingTrials = Math.max(0, minimumTrials - trials);
  if (value.missingTrials !== missingTrials) throw new Error(`BUY ROI ${label} missingTrials mismatch`);
  if (trials < minimumTrials) {
    if (value.status !== "INSUFFICIENT_SUPPORT" || value.interval !== null) throw new Error(`BUY ROI ${label} must stay unavailable below support floor`);
    return { status: "INSUFFICIENT_SUPPORT", trials, minimumTrials, missingTrials, interval: null };
  }
  if (value.status !== "AVAILABLE" || pointEstimate === null) throw new Error(`BUY ROI ${label} unexpectedly unavailable`);
  const interval = parseRoiInterval(value.interval, trials, pointEstimate, label);
  return { status: "AVAILABLE", trials, minimumTrials, missingTrials: 0, interval };
}

function parseRoiInterval(value: unknown, trials: number, pointEstimate: number, label: string): OwnerBuyRoiBootstrapInterval {
  if (!isRecord(value)) throw new Error(`invalid BUY ROI ${label} interval`);
  for (const key of ROI_INTERVAL_KEYS) if (!(key in value)) throw new Error(`BUY ROI ${label} interval missing ${key}`);
  for (const key of Object.keys(value)) if (!ROI_INTERVAL_KEYS.has(key)) throw new Error(`BUY ROI ${label} interval unknown ${key}`);
  if (value.confidenceLevel !== 0.95 || value.method !== "DETERMINISTIC_PERCENTILE_BOOTSTRAP" || value.trials !== trials) throw new Error(`BUY ROI ${label} interval identity mismatch`);
  if (!Number.isInteger(value.iterations) || Number(value.iterations) < 1000 || Number(value.iterations) > 50000) throw new Error(`invalid BUY ROI ${label} iterations`);
  for (const key of ["pointEstimate", "lower", "upper", "width"] as const) if (!isNonNegativeFinite(value[key])) throw new Error(`invalid BUY ROI ${label}.${key}`);
  if (value.breakEven !== 1 || !ROI_CLASSIFICATIONS.has(String(value.classification))) throw new Error(`invalid BUY ROI ${label} classification`);
  if (Math.abs(Number(value.pointEstimate) - pointEstimate) > 0.0001) throw new Error(`BUY ROI ${label} point estimate mismatch`);
  if (Number(value.lower) > Number(value.pointEstimate) || Number(value.pointEstimate) > Number(value.upper)) throw new Error(`BUY ROI ${label} bounds inconsistent`);
  if (Math.abs(Number(value.width) - round4(Number(value.upper) - Number(value.lower))) > 0.0001) throw new Error(`BUY ROI ${label} width mismatch`);
  const expectedClassification = Number(value.lower) > 1 ? "ABOVE_BREAK_EVEN" : Number(value.upper) < 1 ? "BELOW_BREAK_EVEN" : "CROSSES_BREAK_EVEN";
  if (value.classification !== expectedClassification) throw new Error(`BUY ROI ${label} classification mismatch`);
  return value as unknown as OwnerBuyRoiBootstrapInterval;
}

function validatePatternProjection(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid patternSupport"), undefined;
  exactKeys(value, PATTERN_KEYS, "$.patternSupport", errors);
  if (!PATTERN_STATUSES.has(String(value.status))) errors.push("invalid patternSupport.status");
  if (!(value.noSignalReason === null || NO_SIGNAL_REASONS.has(String(value.noSignalReason)))) errors.push("invalid patternSupport.noSignalReason");
  for (const key of ["analyzedSettled", "minimumSettledPerSide", "minimumTotalSettledForAnyContrast", "globalAdditionalSettledForAnyContrast", "validSegmentCount", "segmentSideEligibleCount", "universalEligibleSegmentCount", "supportedContrastCount", "supportedDimensionCount", "patternSignalCount"] as const) if (!isCount(value[key])) errors.push(`invalid patternSupport.${key}`);
  if (!(value.closestObservedComplementSettled === null || isCount(value.closestObservedComplementSettled))) errors.push("invalid patternSupport.closestObservedComplementSettled");
  if (!(value.minimumObservedComplementShortfall === null || isCount(value.minimumObservedComplementShortfall))) errors.push("invalid patternSupport.minimumObservedComplementShortfall");
  if (!(value.contrastBlocker === null || PATTERN_BLOCKERS.has(String(value.contrastBlocker)))) errors.push("invalid patternSupport.contrastBlocker");
  if (isCount(value.segmentSideEligibleCount) && isCount(value.universalEligibleSegmentCount) && Number(value.universalEligibleSegmentCount) > Number(value.segmentSideEligibleCount)) errors.push("invalid patternSupport universal count");
  if (isCount(value.minimumSettledPerSide) && isCount(value.closestObservedComplementSettled) && isCount(value.minimumObservedComplementShortfall) && Number(value.minimumObservedComplementShortfall) !== Math.max(0, Number(value.minimumSettledPerSide) - Number(value.closestObservedComplementSettled))) errors.push("invalid patternSupport complement shortfall");
}

function validateHitRateProjection(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid hitRateUncertainty"), undefined;
  exactKeys(value, HIT_RATE_KEYS, "$.hitRateUncertainty", errors);
  if (value.status !== "AVAILABLE") errors.push("invalid hitRateUncertainty.status");
  validateInterval(value.performance, "$.hitRateUncertainty.performance", errors);
  validateInterval(value.recent, "$.hitRateUncertainty.recent", errors);
}

function validateInterval(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`invalid ${path}`), undefined;
  exactKeys(value, INTERVAL_KEYS, path, errors);
  if (value.confidenceLevel !== 0.95 || value.method !== "WILSON_SCORE" || !isCount(value.trials) || !isCount(value.successes) || Number(value.successes) > Number(value.trials)) errors.push(`invalid ${path} identity`);
  for (const key of ["pointEstimate", "lower", "upper", "width"] as const) if (!(value[key] === null || isProbability(value[key]))) errors.push(`invalid ${path}.${key}`);
}

function validateRoiProjection(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid roiUncertainty"), undefined;
  exactKeys(value, ROI_KEYS, "$.roiUncertainty", errors);
  if (!ROI_SCOPE_STATUSES.has(String(value.status)) || !isCount(value.minimumTrials) || Number(value.minimumTrials) < 20) errors.push("invalid roiUncertainty identity");
  validateRoiScopeProjection(value.performance, "$.roiUncertainty.performance", errors);
  validateRoiScopeProjection(value.recent, "$.roiUncertainty.recent", errors);
}

function validateRoiScopeProjection(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`invalid ${path}`), undefined;
  exactKeys(value, ROI_SCOPE_KEYS, path, errors);
  if (!ROI_SCOPE_STATUSES.has(String(value.status)) || !isCount(value.trials) || !isCount(value.minimumTrials) || !isCount(value.missingTrials)) errors.push(`invalid ${path} support`);
  if (value.status === "INSUFFICIENT_SUPPORT") {
    if (value.interval !== null) errors.push(`invalid ${path}.interval`);
    return;
  }
  validateRoiIntervalProjection(value.interval, `${path}.interval`, errors);
}

function validateRoiIntervalProjection(value: unknown, path: string, errors: string[]) {
  if (!isRecord(value)) return errors.push(`invalid ${path}`), undefined;
  exactKeys(value, ROI_INTERVAL_KEYS, path, errors);
  if (value.confidenceLevel !== 0.95 || value.method !== "DETERMINISTIC_PERCENTILE_BOOTSTRAP" || !isCount(value.trials) || !isCount(value.iterations) || Number(value.iterations) < 1000) errors.push(`invalid ${path} identity`);
  for (const key of ["pointEstimate", "lower", "upper", "width"] as const) if (!isNonNegativeFinite(value[key])) errors.push(`invalid ${path}.${key}`);
  if (value.breakEven !== 1 || !ROI_CLASSIFICATIONS.has(String(value.classification))) errors.push(`invalid ${path} classification`);
}

function validateTailProjection(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid tailStability"), undefined;
  exactKeys(value, TAIL_KEYS, "$.tailStability", errors);
  if (!TAIL_STATUSES.has(String(value.status))) errors.push("invalid tailStability.status");
  for (const key of ["windowSize", "totalSettled", "recentSettled", "priorSettled", "missingSettledToCompare"] as const) if (!isCount(value[key])) errors.push(`invalid tailStability.${key}`);
  if (!isFiniteNumber(value.minimumTailGap)) errors.push("invalid tailStability.minimumTailGap");
  for (const key of ["recentTailGap", "priorTailGap"] as const) if (!(value[key] === null || isFiniteNumber(value[key]))) errors.push(`invalid tailStability.${key}`);
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) { for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown key`); for (const key of allowed) if (!(key in value)) errors.push(`${path}.${key}: required`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCount(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function nullableCount(value: unknown, name: string): number | null { if (value === null) return null; if (!isCount(value)) throw new Error(`invalid BUY pattern support ${name}`); return Number(value); }
function isProbability(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isNonNegativeFinite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isIso(value: unknown): value is string { return typeof value === "string" && RFC3339_TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value)); }
function round4(value: number): number { return Math.round(value * 10000) / 10000; }