import { createHash } from "node:crypto";

export const RUNTIME_DECISION_LEDGER_SCHEMA_VERSION = "runtime-decision-ledger.0.1" as const;

export type RuntimeDecision = "BUY" | "WATCH" | "SKIP";
export type RuntimeEvaluationMode = "formal_forward" | "shadow_forward" | "historical" | "validation" | "future_only";
export type RuntimeDataCompleteness = "complete" | "partial" | "blocked";

export type RuntimeDecisionLedgerRecord = {
  schemaVersion: typeof RUNTIME_DECISION_LEDGER_SCHEMA_VERSION;
  recordId: string;
  decisionId: string;
  canonicalRaceId: string;
  sourceDecisionHistoryId: number | null;
  decisionSystem: string;
  strategyVersion: string;
  modelVersion: string;
  featureVersion: string;
  manifestId: string;
  cohortId: string;
  evaluationMode: RuntimeEvaluationMode;
  ticketType: string;
  selection: string;
  decision: RuntimeDecision;
  decisionAt: string;
  oddsObservedAt: string | null;
  scheduledCloseAtSeen: string;
  currentOdds: number | null;
  requiredOdds: number | null;
  estimatedHitRate: number | null;
  rawEstimatedHitRate: number | null;
  expectedValue: number | null;
  recommendedStakeYen: number;
  sampleSize: number;
  reasons: string[];
  warnings: string[];
  dataCompleteness: RuntimeDataCompleteness;
  notificationEligible: boolean;
  notificationDedupeKey: string | null;
  sourceRowDigest: string;
};

export type RuntimeDecisionLedgerValidation = {
  valid: boolean;
  errors: string[];
};

const ALLOWED_FIELDS = new Set<keyof RuntimeDecisionLedgerRecord>([
  "schemaVersion",
  "recordId",
  "decisionId",
  "canonicalRaceId",
  "sourceDecisionHistoryId",
  "decisionSystem",
  "strategyVersion",
  "modelVersion",
  "featureVersion",
  "manifestId",
  "cohortId",
  "evaluationMode",
  "ticketType",
  "selection",
  "decision",
  "decisionAt",
  "oddsObservedAt",
  "scheduledCloseAtSeen",
  "currentOdds",
  "requiredOdds",
  "estimatedHitRate",
  "rawEstimatedHitRate",
  "expectedValue",
  "recommendedStakeYen",
  "sampleSize",
  "reasons",
  "warnings",
  "dataCompleteness",
  "notificationEligible",
  "notificationDedupeKey",
  "sourceRowDigest",
]);

const DECISIONS = new Set<RuntimeDecision>(["BUY", "WATCH", "SKIP"]);
const EVALUATION_MODES = new Set<RuntimeEvaluationMode>([
  "formal_forward",
  "shadow_forward",
  "historical",
  "validation",
  "future_only",
]);
const COMPLETENESS = new Set<RuntimeDataCompleteness>(["complete", "partial", "blocked"]);
const EXACT_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseInstant(value: unknown, field: string, errors: string[]): number | null {
  if (!isNonEmptyString(value) || !EXACT_INSTANT_RE.test(value)) {
    errors.push(`${field} must be a timezone-bound ISO timestamp`);
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${field} must be a valid ISO timestamp`);
    return null;
  }
  return parsed;
}

function validateProbability(value: unknown, field: string, errors: string[]): void {
  if (!isNullableFiniteNumber(value)) {
    errors.push(`${field} must be finite or null`);
    return;
  }
  if (value != null && (value < 0 || value > 1)) errors.push(`${field} must be between 0 and 1`);
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    errors.push(`${field} must be an array of non-empty strings`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function runtimeDecisionLedgerDigest(record: RuntimeDecisionLedgerRecord): string {
  const canonical = JSON.stringify(canonicalize(record));
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateRuntimeDecisionLedgerRecord(value: unknown): RuntimeDecisionLedgerValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["record must be an object"] };

  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field as keyof RuntimeDecisionLedgerRecord)) {
      errors.push(`unknown field is not allowed: ${field}`);
    }
  }

  if (value.schemaVersion !== RUNTIME_DECISION_LEDGER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${RUNTIME_DECISION_LEDGER_SCHEMA_VERSION}`);
  }

  for (const field of [
    "recordId",
    "decisionId",
    "canonicalRaceId",
    "decisionSystem",
    "strategyVersion",
    "modelVersion",
    "featureVersion",
    "manifestId",
    "cohortId",
    "ticketType",
    "selection",
    "sourceRowDigest",
  ] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (isNonEmptyString(value.sourceRowDigest) && !/^[0-9a-f]{64}$/i.test(value.sourceRowDigest)) {
    errors.push("sourceRowDigest must be a SHA-256 hex digest");
  }

  if (value.sourceDecisionHistoryId !== null && !isPositiveInteger(value.sourceDecisionHistoryId)) {
    errors.push("sourceDecisionHistoryId must be a positive integer or null");
  }

  if (!DECISIONS.has(value.decision as RuntimeDecision)) errors.push("decision must be BUY, WATCH, or SKIP");
  if (!EVALUATION_MODES.has(value.evaluationMode as RuntimeEvaluationMode)) errors.push("evaluationMode is invalid");
  if (!COMPLETENESS.has(value.dataCompleteness as RuntimeDataCompleteness)) errors.push("dataCompleteness is invalid");

  const decisionAt = parseInstant(value.decisionAt, "decisionAt", errors);
  const scheduledCloseAtSeen = parseInstant(value.scheduledCloseAtSeen, "scheduledCloseAtSeen", errors);
  let oddsObservedAt: number | null = null;
  if (value.oddsObservedAt !== null) oddsObservedAt = parseInstant(value.oddsObservedAt, "oddsObservedAt", errors);

  if (decisionAt != null && scheduledCloseAtSeen != null && decisionAt > scheduledCloseAtSeen) {
    errors.push("decisionAt must not be after scheduledCloseAtSeen");
  }
  if (decisionAt != null && oddsObservedAt != null && oddsObservedAt > decisionAt) {
    errors.push("oddsObservedAt must not be after decisionAt");
  }

  for (const field of ["currentOdds", "requiredOdds", "expectedValue"] as const) {
    if (!isNullableFiniteNumber(value[field])) errors.push(`${field} must be finite or null`);
  }
  if (typeof value.currentOdds === "number" && value.currentOdds <= 0) errors.push("currentOdds must be greater than 0");
  if (typeof value.requiredOdds === "number" && value.requiredOdds <= 0) errors.push("requiredOdds must be greater than 0");
  validateProbability(value.estimatedHitRate, "estimatedHitRate", errors);
  validateProbability(value.rawEstimatedHitRate, "rawEstimatedHitRate", errors);

  if (!isNonNegativeInteger(value.recommendedStakeYen)) {
    errors.push("recommendedStakeYen must be a non-negative integer");
  }
  if (!isNonNegativeInteger(value.sampleSize)) {
    errors.push("sampleSize must be a non-negative integer");
  }
  validateStringArray(value.reasons, "reasons", errors);
  validateStringArray(value.warnings, "warnings", errors);

  if (typeof value.notificationEligible !== "boolean") errors.push("notificationEligible must be boolean");
  if (value.notificationDedupeKey !== null && !isNonEmptyString(value.notificationDedupeKey)) {
    errors.push("notificationDedupeKey must be a non-empty string or null");
  }
  if (value.notificationEligible === true && value.decision !== "BUY") {
    errors.push("notificationEligible may only be true for BUY decisions");
  }
  if (value.notificationEligible === true && !isNonEmptyString(value.notificationDedupeKey)) {
    errors.push("notificationEligible BUY requires notificationDedupeKey");
  }

  if (value.decision === "BUY") {
    if (value.dataCompleteness !== "complete") errors.push("BUY requires dataCompleteness=complete");
    if (value.currentOdds === null) errors.push("BUY requires currentOdds");
    if (value.requiredOdds === null) errors.push("BUY requires requiredOdds");
    if (value.estimatedHitRate === null) errors.push("BUY requires estimatedHitRate");
    if (value.expectedValue === null) errors.push("BUY requires expectedValue");
    if (!isPositiveInteger(value.recommendedStakeYen)) {
      errors.push("BUY requires recommendedStakeYen greater than 0");
    }
    if (value.oddsObservedAt === null) errors.push("BUY requires oddsObservedAt");
  }

  return { valid: errors.length === 0, errors };
}