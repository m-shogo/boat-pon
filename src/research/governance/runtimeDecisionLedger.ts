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
const EXACT_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

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
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isExactInstant(value: string): boolean {
  const match = EXACT_INSTANT_RE.exec(value);
  if (!match || value.endsWith("-00:00")) return false;
  // RegExp match arrays must be read by index: an inherited iterator can erase captures.
  const yearText = match[1], monthText = match[2], dayText = match[3];
  const hourText = match[4], minuteText = match[5], secondText = match[6];
  const offsetHourText = match[7], offsetMinuteText = match[8];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;
  if (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return true;
}

// A mutated Array.prototype.push or inherited numeric setter must not suppress
// a failed admission check. Preserve each error as an own array data property.
function appendValidationError(errors: string[], message: string): void {
  Object.defineProperty(errors, String(errors.length), {
    value: message, enumerable: true, writable: true, configurable: true,
  });
}

function validationResult(valid: boolean, errors: string[]): RuntimeDecisionLedgerValidation {
  Object.freeze(errors);
  return Object.freeze({ valid, errors });
}

function parseInstant(value: unknown, field: string, errors: string[]): number | null {
  if (!isNonEmptyString(value) || !isExactInstant(value)) {
    appendValidationError(errors, `${field} must be a valid timezone-bound ISO timestamp`);
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    appendValidationError(errors, `${field} must be a valid timezone-bound ISO timestamp`);
    return null;
  }
  return parsed;
}

// Preserve sub-millisecond PIT chronology across equivalent UTC offsets.
function compareExactInstants(a: string, b: string): number {
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/u;
  const wholeSecond = (instant: string) => Date.parse(instant.replace(fraction, ""));
  const aSecond = wholeSecond(a);
  const bSecond = wholeSecond(b);
  if (aSecond !== bSecond) return aSecond < bSecond ? -1 : 1;
  const aFraction = fraction.exec(a)?.[1] ?? "";
  const bFraction = fraction.exec(b)?.[1] ?? "";
  const width = Math.max(aFraction.length, bFraction.length);
  const left = aFraction.padEnd(width, "0");
  const right = bFraction.padEnd(width, "0");
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateProbability(value: unknown, field: string, errors: string[]): void {
  if (!isNullableFiniteNumber(value)) {
    appendValidationError(errors, `${field} must be finite or null`);
    return;
  }
  if (value != null && (value < 0 || value > 1)) appendValidationError(errors, `${field} must be between 0 and 1`);
}

// Validate the same own enumerable data fields that JSON persistence will observe.
function isOwnSerializableDataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    if ("toJSON" in value) return false;
    const keys = Reflect.ownKeys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    }
    return true;
  } catch { return false; }
}

function isDenseSerializableStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || "toJSON" in value) return false;
    if (Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !isNonEmptyString(descriptor.value)) return false;
    }
    return true;
  } catch { return false; }
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!isDenseSerializableStringArray(value)) {
    appendValidationError(errors, `${field} must be an array of non-empty strings`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (!isDenseSerializableStringArray(value)) throw new TypeError("non-JSON array in Runtime Decision Ledger");
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new TypeError("non-JSON array in Runtime Decision Ledger");
      return canonicalize(descriptor.value);
    });
  }
  if (value !== null && typeof value === "object") {
    if (!isOwnSerializableDataObject(value)) throw new TypeError("non-JSON object in Runtime Decision Ledger");
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new TypeError("non-JSON object in Runtime Decision Ledger");
      return [key, canonicalize(descriptor.value)];
    }));
  }
  return value;
}

export function runtimeDecisionLedgerDigest(record: RuntimeDecisionLedgerRecord): string {
    if (!validateRuntimeDecisionLedgerRecord(record).valid) throw new TypeError("invalid Runtime Decision Ledger record");
const canonical = JSON.stringify(canonicalize(record));
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateRuntimeDecisionLedgerRecord(value: unknown): RuntimeDecisionLedgerValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return validationResult(false, ["record must be an object"]);
  if (!isOwnSerializableDataObject(value)) return validationResult(false, ["record fields must be enumerable own data properties"]);
  for (const field of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      return validationResult(false, [`missing own field: ${field}`]);
    }
  }

  const actualFields = Object.keys(value);
  for (let index = 0; index < actualFields.length; index++) {
    const field = actualFields[index]!;
    if (!ALLOWED_FIELDS.has(field as keyof RuntimeDecisionLedgerRecord)) {
      appendValidationError(errors, `unknown field is not allowed: ${field}`);
    }
  }

  if (value.schemaVersion !== RUNTIME_DECISION_LEDGER_SCHEMA_VERSION) {
    appendValidationError(errors, `schemaVersion must be ${RUNTIME_DECISION_LEDGER_SCHEMA_VERSION}`);
  }

  const requiredStrings = [
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
  ] as const;
  for (let index = 0; index < requiredStrings.length; index++) {
    const field = requiredStrings[index]!;
    if (!isNonEmptyString(value[field])) appendValidationError(errors, `${field} must be a non-empty string`);
  }
  if (isNonEmptyString(value.sourceRowDigest) && !/^[0-9a-f]{64}$/.test(value.sourceRowDigest)) {
    appendValidationError(errors, "sourceRowDigest must be a SHA-256 hex digest");
  }

  if (value.sourceDecisionHistoryId !== null && !isPositiveInteger(value.sourceDecisionHistoryId)) {
    appendValidationError(errors, "sourceDecisionHistoryId must be a positive integer or null");
  }

  if (!DECISIONS.has(value.decision as RuntimeDecision)) appendValidationError(errors, "decision must be BUY, WATCH, or SKIP");
  if (!EVALUATION_MODES.has(value.evaluationMode as RuntimeEvaluationMode)) appendValidationError(errors, "evaluationMode is invalid");
  if (!COMPLETENESS.has(value.dataCompleteness as RuntimeDataCompleteness)) appendValidationError(errors, "dataCompleteness is invalid");

  const decisionAt = parseInstant(value.decisionAt, "decisionAt", errors);
  const scheduledCloseAtSeen = parseInstant(value.scheduledCloseAtSeen, "scheduledCloseAtSeen", errors);
  let oddsObservedAt: number | null = null;
  if (value.oddsObservedAt !== null) oddsObservedAt = parseInstant(value.oddsObservedAt, "oddsObservedAt", errors);

  if (decisionAt != null && scheduledCloseAtSeen != null && compareExactInstants(value.decisionAt as string, value.scheduledCloseAtSeen as string) > 0) {
    appendValidationError(errors, "decisionAt must not be after scheduledCloseAtSeen");
  }
  if (decisionAt != null && oddsObservedAt != null && compareExactInstants(value.oddsObservedAt as string, value.decisionAt as string) > 0) {
    appendValidationError(errors, "oddsObservedAt must not be after decisionAt");
  }

  const nullableNumbers = ["currentOdds", "requiredOdds", "expectedValue"] as const;
  for (let index = 0; index < nullableNumbers.length; index++) {
    const field = nullableNumbers[index]!;
    if (!isNullableFiniteNumber(value[field])) appendValidationError(errors, `${field} must be finite or null`);
  }
  if (typeof value.currentOdds === "number" && value.currentOdds <= 0) appendValidationError(errors, "currentOdds must be greater than 0");
  if (typeof value.requiredOdds === "number" && value.requiredOdds <= 0) appendValidationError(errors, "requiredOdds must be greater than 0");
  validateProbability(value.estimatedHitRate, "estimatedHitRate", errors);
  validateProbability(value.rawEstimatedHitRate, "rawEstimatedHitRate", errors);

  if (!isNonNegativeInteger(value.recommendedStakeYen)) {
    appendValidationError(errors, "recommendedStakeYen must be a non-negative integer");
  }
  if (!isNonNegativeInteger(value.sampleSize)) {
    appendValidationError(errors, "sampleSize must be a non-negative integer");
  }
  validateStringArray(value.reasons, "reasons", errors);
  validateStringArray(value.warnings, "warnings", errors);

  if (typeof value.notificationEligible !== "boolean") appendValidationError(errors, "notificationEligible must be boolean");
  if (value.notificationDedupeKey !== null && !isNonEmptyString(value.notificationDedupeKey)) {
    appendValidationError(errors, "notificationDedupeKey must be a non-empty string or null");
  }
  if (value.notificationEligible === true && value.decision !== "BUY") {
    appendValidationError(errors, "notificationEligible may only be true for BUY decisions");
  }
  if (value.notificationEligible === true && !isNonEmptyString(value.notificationDedupeKey)) {
    appendValidationError(errors, "notificationEligible BUY requires notificationDedupeKey");
  }

  if (value.decision === "BUY") {
    if (value.dataCompleteness !== "complete") appendValidationError(errors, "BUY requires dataCompleteness=complete");
    if (value.currentOdds === null) appendValidationError(errors, "BUY requires currentOdds");
    if (value.requiredOdds === null) appendValidationError(errors, "BUY requires requiredOdds");
    if (value.estimatedHitRate === null) appendValidationError(errors, "BUY requires estimatedHitRate");
    if (value.expectedValue === null) appendValidationError(errors, "BUY requires expectedValue");
    if (!isPositiveInteger(value.recommendedStakeYen)) {
      appendValidationError(errors, "BUY requires recommendedStakeYen greater than 0");
    }
    if (value.oddsObservedAt === null) appendValidationError(errors, "BUY requires oddsObservedAt");
  }

  return validationResult(errors.length === 0, errors);
}
