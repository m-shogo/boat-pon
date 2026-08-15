import { validateBuyLearningSummary, type BuyLearningSummary } from "./buyLearningSummary";
import { validateBuyTailPublicSignal } from "./buyTailLearningMerge";

export const OWNER_BUY_EVIDENCE_SCHEMA_VERSION = "owner-buy-evidence-diagnostics-v1" as const;

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
    supportedContrastCount: number;
    supportedDimensionCount: number;
    patternSignalCount: number;
  };
  hitRateUncertainty: null | {
    status: "AVAILABLE";
    performance: OwnerBuyWilsonInterval;
    recent: OwnerBuyWilsonInterval;
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
};

const TOP_KEYS = new Set(["schemaVersion", "generatedAt", "status", "patternSupport", "hitRateUncertainty", "tailStability", "productionChangeAllowed"]);
const PATTERN_KEYS = new Set(["status", "noSignalReason", "analyzedSettled", "minimumSettledPerSide", "minimumTotalSettledForAnyContrast", "globalAdditionalSettledForAnyContrast", "validSegmentCount", "segmentSideEligibleCount", "supportedContrastCount", "supportedDimensionCount", "patternSignalCount"]);
const HIT_RATE_KEYS = new Set(["status", "performance", "recent"]);
const INTERVAL_KEYS = new Set(["confidenceLevel", "method", "trials", "successes", "pointEstimate", "lower", "upper", "width"]);
const TAIL_KEYS = new Set(["status", "windowSize", "minimumTailGap", "totalSettled", "recentSettled", "priorSettled", "missingSettledToCompare", "recentTailGap", "priorTailGap"]);
const PATTERN_STATUSES = new Set(["INSUFFICIENT_GLOBAL_SUPPORT", "NO_SUPPORTED_CONTRAST", "SUPPORTED_CONTRASTS"]);
const NO_SIGNAL_REASONS = new Set(["INSUFFICIENT_GLOBAL_SUPPORT", "NO_SUPPORTED_CONTRAST", "NO_MATERIAL_ROI_CONTRAST"]);
const TAIL_STATUSES = new Set(["INSUFFICIENT_SUPPORT", "PERSISTENT_TAIL_DEPENDENCE", "RECENT_TAIL_DEPENDENCE", "PRIOR_TAIL_DEPENDENCE", "NO_TAIL_DEPENDENCE_SIGNAL"]);
const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function unavailableOwnerBuyEvidenceDiagnostics(generatedAt: string): OwnerBuyEvidenceDiagnostics {
  return {
    schemaVersion: OWNER_BUY_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    status: "NOT_AVAILABLE",
    patternSupport: null,
    hitRateUncertainty: null,
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
  const recentSettled = buyLearning.recent.settled;
  const recentHits = buyLearning.recent.hits;
  if (settled === null || hits === null || recentSettled === null || recentHits === null) throw new Error("AVAILABLE BUY learning must include settled counts");

  const patternSupport = parsePatternSupport(input.patterns, settled);
  const hitRateUncertainty = parseHitRateUncertainty(input.uncertainty, { settled, hits, recentSettled, recentHits });
  const tail = validateBuyTailPublicSignal(input.tail);
  if (tail.totalSettled !== settled) throw new Error("BUY tail/dashboard settled count mismatch");

  const diagnostics: OwnerBuyEvidenceDiagnostics = {
    schemaVersion: OWNER_BUY_EVIDENCE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    status: "AVAILABLE",
    patternSupport,
    hitRateUncertainty,
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
    if (value.patternSupport !== null || value.hitRateUncertainty !== null || value.tailStability !== null) errors.push("NOT_AVAILABLE diagnostics must keep evidence null");
  } else {
    validatePatternProjection(value.patternSupport, errors);
    validateHitRateProjection(value.hitRateUncertainty, errors);
    validateTailProjection(value.tailStability, errors);
  }

  const serialized = JSON.stringify(value);
  for (const forbidden of ["selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "segmentKey", "/Users/", "/home/", "app_settings", "automation/requests", "holdoutRawKey"]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`private marker forbidden: ${forbidden}`);
  }
  if (serialized.length > 16000) errors.push("diagnostics too large");
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
  for (const key of ["minimumSettledPerSide", "minimumTotalSettledForAnyContrast", "globalAdditionalSettledForAnyContrast", "validSegmentCount", "segmentSideEligibleCount", "supportedContrastCount", "supportedDimensionCount"] as const) {
    if (!isCount(support[key])) throw new Error(`invalid BUY pattern support ${key}`);
  }
  const minimumSettledPerSide = Number(support.minimumSettledPerSide);
  const minimumTotalSettledForAnyContrast = Number(support.minimumTotalSettledForAnyContrast);
  const globalAdditionalSettledForAnyContrast = Number(support.globalAdditionalSettledForAnyContrast);
  const validSegmentCount = Number(support.validSegmentCount);
  const segmentSideEligibleCount = Number(support.segmentSideEligibleCount);
  const supportedContrastCount = Number(support.supportedContrastCount);
  const supportedDimensionCount = Number(support.supportedDimensionCount);
  if (minimumSettledPerSide < 1 || minimumTotalSettledForAnyContrast !== minimumSettledPerSide * 2) throw new Error("invalid BUY pattern two-sided support floor");
  if (globalAdditionalSettledForAnyContrast !== Math.max(0, minimumTotalSettledForAnyContrast - settled)) throw new Error("BUY pattern global support delta mismatch");
  if (segmentSideEligibleCount > validSegmentCount || supportedContrastCount > segmentSideEligibleCount || supportedDimensionCount > 6) throw new Error("BUY pattern support counts inconsistent");
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

function validatePatternProjection(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("invalid patternSupport"), undefined;
  exactKeys(value, PATTERN_KEYS, "$.patternSupport", errors);
  if (!PATTERN_STATUSES.has(String(value.status))) errors.push("invalid patternSupport.status");
  if (!(value.noSignalReason === null || NO_SIGNAL_REASONS.has(String(value.noSignalReason)))) errors.push("invalid patternSupport.noSignalReason");
  for (const key of ["analyzedSettled", "minimumSettledPerSide", "minimumTotalSettledForAnyContrast", "globalAdditionalSettledForAnyContrast", "validSegmentCount", "segmentSideEligibleCount", "supportedContrastCount", "supportedDimensionCount", "patternSignalCount"] as const) if (!isCount(value[key])) errors.push(`invalid patternSupport.${key}`);
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
function isProbability(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && RFC3339_TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value)); }
