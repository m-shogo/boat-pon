import { createHash } from "node:crypto";

export const OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION = "outcome-learning-ledger.0.1" as const;

export type OutcomeFinality = "FINAL" | "VOID";
export type OutcomeDisposition = "SETTLED" | "REFUNDED" | "VOID";

export type OutcomeLearningLedgerRecord = {
  schemaVersion: typeof OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION;
  outcomeRecordId: string;
  decisionRecordId: string;
  decisionId: string;
  canonicalRaceId: string;
  ticketType: string;
  selection: string;
  settlementId: string;
  settledAt: string;
  finality: OutcomeFinality;
  disposition: OutcomeDisposition;
  evaluable: boolean;
  stakeYen: number;
  payoutYen: number;
  refundYen: number;
  refundReason: string | null;
  popularity: number | null;
  sourceEvidenceDigests: string[];
  provenanceVersion: string;
};

export type OutcomeReconciliationState =
  | "EXACT"
  | "UNRESOLVED_DECISION"
  | "UNRESOLVED_SETTLEMENT_IDENTITY"
  | "UNRESOLVED_TICKET_LINK"
  | "UNRESOLVED_REFUND_OR_INVALIDATION"
  | "UNRESOLVED_FINALITY"
  | "CONFLICT"
  | "REJECTED_INVALID";

export type OutcomeLedgerAppendDecision = "APPEND" | "IDEMPOTENT_NOOP" | "CONFLICT" | "REJECTED_INVALID";
export type OutcomeLearningLedgerValidation = { valid: boolean; errors: string[] };

const REQUIRED_FIELDS: ReadonlyArray<keyof OutcomeLearningLedgerRecord> = [
  "schemaVersion", "outcomeRecordId", "decisionRecordId", "decisionId", "canonicalRaceId",
  "ticketType", "selection", "settlementId", "settledAt", "finality", "disposition",
  "evaluable", "stakeYen", "payoutYen", "refundYen", "refundReason", "popularity",
  "sourceEvidenceDigests", "provenanceVersion",
];
const ALLOWED_FIELDS = new Set<keyof OutcomeLearningLedgerRecord>(REQUIRED_FIELDS);
const SHA256_RE = /^[0-9a-f]{64}$/u;
const EXACT_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && !("toJSON" in value);
  } catch { return false; }
}
// JSON persistence and canonical digest must observe exactly the same own data fields.
function hasOwnEnumerableDataFields(value: Record<string, unknown>): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    }
    for (let index = 0; index < REQUIRED_FIELDS.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, REQUIRED_FIELDS[index]!)) return false;
    }
    return true;
  } catch { return false; }
}
function hasDenseDigestArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || "toJSON" in value ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
          typeof descriptor.value !== "string" || !SHA256_RE.test(descriptor.value)) return false;
    }
    return true;
  } catch { return false; }
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function isExactInstant(value: string): boolean {
  const match = EXACT_INSTANT_RE.exec(value);
  if (!match || value.endsWith("-00:00")) return false;
  // RegExp captures are indexed: destructuring would use a mutable array iterator.
  const y = match[1], mo = match[2], d = match[3];
  const h = match[4], mi = match[5], s = match[6];
  const oh = match[7], om = match[8];
  const year = Number(y), month = Number(mo), day = Number(d);
  if (year === 0 || month < 1 || month > 12 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > days) return false;
  return oh === undefined || (Number(oh) <= 23 && Number(om) <= 59);
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("invalid canonical array data");
      }
      Object.defineProperty(result, String(index), {
      value: canonicalize(descriptor.value), enumerable: true, writable: true, configurable: true,
    });
    }
    return result;
  }
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  // Avoid mutable Array.prototype.map/sort and inherited array iterators.
  for (let index = 1; index < keys.length; index++) {
    const key = keys[index]!;
    let previous = index - 1;
    while (previous >= 0 && keys[previous]! > key) {
      keys[previous + 1] = keys[previous]!;
      previous--;
    }
    keys[previous + 1] = key;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("invalid canonical object data");
    }
    result[key] = canonicalize(descriptor.value);
  }
  return result;
}

export function outcomeLearningLedgerDigest(record: OutcomeLearningLedgerRecord): string {
  // Direct hashing must enforce the same admission contract as append classification.
  if (!validateOutcomeLearningLedgerRecord(record).valid) throw new TypeError("invalid Outcome Learning Ledger record");
  return createHash("sha256").update(JSON.stringify(canonicalize(record))).digest("hex");
}

export function classifyOutcomeLedgerAppend(
  existing: OutcomeLearningLedgerRecord | undefined,
  candidate: unknown,
): OutcomeLedgerAppendDecision {
  const validation = validateOutcomeLearningLedgerRecord(candidate);
  if (!validation.valid) return "REJECTED_INVALID";
  const next = candidate as OutcomeLearningLedgerRecord;
  if (existing === undefined) return "APPEND";
  if (!validateOutcomeLearningLedgerRecord(existing).valid) return "REJECTED_INVALID";
  if (existing.outcomeRecordId !== next.outcomeRecordId) return "CONFLICT";
  return outcomeLearningLedgerDigest(existing) === outcomeLearningLedgerDigest(next)
    ? "IDEMPOTENT_NOOP"
    : "CONFLICT";
}

export function classifyOutcomeReconciliation(input: {
  decisionExact: boolean;
  settlementIdentityExact: boolean;
  ticketLinkExact: boolean;
  refundOrInvalidationExact: boolean;
  finalityExact: boolean;
}): OutcomeReconciliationState {
  // TypeScript annotations do not validate evidence supplied at runtime.
  // Read own data descriptors so malformed accessors cannot manufacture EXACT.
  const fields = [
    "decisionExact", "settlementIdentityExact", "ticketLinkExact",
    "refundOrInvalidationExact", "finalityExact",
  ] as const;
  const flags: boolean[] = [];
  try {
    if (!isRecord(input) || Reflect.ownKeys(input).length !== fields.length) return "REJECTED_INVALID";
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index]!;
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "boolean") {
        return "REJECTED_INVALID";
      }
      flags[index] = descriptor.value;
    }
  } catch {
    return "REJECTED_INVALID";
  }
  if (!flags[0]) return "UNRESOLVED_DECISION";
  if (!flags[1]) return "UNRESOLVED_SETTLEMENT_IDENTITY";
  if (!flags[2]) return "UNRESOLVED_TICKET_LINK";
  if (!flags[3]) return "UNRESOLVED_REFUND_OR_INVALIDATION";
  if (!flags[4]) return "UNRESOLVED_FINALITY";
  return "EXACT";
}

function validationResult(valid: boolean, errors: string[]): OutcomeLearningLedgerValidation {
  Object.freeze(errors);
  return Object.freeze({ valid, errors });
}

export function validateOutcomeLearningLedgerRecord(value: unknown): OutcomeLearningLedgerValidation {
  const errors: string[] = [];
  // Indexed assignment is intercepted by inherited numeric setters; preserve every rejection as an own property.
  const appendError = (message: string): void => {
    Object.defineProperty(errors, String(errors.length), {
      value: message, enumerable: true, writable: true, configurable: true,
    });
  };
  if (!isRecord(value)) return validationResult(false, ["record must be an object"]);
  if (!hasOwnEnumerableDataFields(value)) return validationResult(false, ["record fields must be enumerable own data properties"]);
  const actualFields = Object.keys(value);
  for (let index = 0; index < actualFields.length; index++) {
    const field = actualFields[index]!;
    if (!ALLOWED_FIELDS.has(field as keyof OutcomeLearningLedgerRecord)) appendError(`unknown field is not allowed: ${field}`);
  }
  if (value.schemaVersion !== OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION) appendError(`schemaVersion must be ${OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION}`);
  const requiredStrings = ["outcomeRecordId", "decisionRecordId", "decisionId", "canonicalRaceId", "ticketType", "selection", "settlementId", "provenanceVersion"] as const;
  for (let index = 0; index < requiredStrings.length; index++) {
    const field = requiredStrings[index]!;
    if (!isNonEmptyString(value[field])) appendError(`${field} must be a non-empty string`);
  }
  if (!isNonEmptyString(value.settledAt) || !isExactInstant(value.settledAt) || !Number.isFinite(Date.parse(value.settledAt))) {
    appendError("settledAt must be a valid timezone-bound ISO timestamp");
  }
  if (value.finality !== "FINAL" && value.finality !== "VOID") appendError("finality must be FINAL or VOID");
  if (value.disposition !== "SETTLED" && value.disposition !== "REFUNDED" && value.disposition !== "VOID") appendError("disposition is invalid");
  if (typeof value.evaluable !== "boolean") appendError("evaluable must be boolean");
  const monetaryFields = ["stakeYen", "payoutYen", "refundYen"] as const;
  for (let index = 0; index < monetaryFields.length; index++) {
    const field = monetaryFields[index]!;
    if (!isSafeNonNegativeInteger(value[field])) appendError(`${field} must be a non-negative safe integer`);
  }
  if (value.refundReason !== null && !isNonEmptyString(value.refundReason)) appendError("refundReason must be a non-empty string or null");
  if (value.popularity !== null && (!Number.isSafeInteger(value.popularity) || (value.popularity as number) <= 0)) appendError("popularity must be a positive safe integer or null");
  if (!hasDenseDigestArray(value.sourceEvidenceDigests)) {
    appendError("sourceEvidenceDigests must contain one or more lowercase SHA-256 digests");
  } else {
    const seen = new Set<string>();
    for (let index = 0; index < value.sourceEvidenceDigests.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value.sourceEvidenceDigests, String(index));
      if (!descriptor || seen.has(descriptor.value as string)) {
        appendError("sourceEvidenceDigests must not contain duplicates");
        break;
      }
      seen.add(descriptor.value as string);
    }
  }

  if (value.disposition === "SETTLED") {
    if (value.finality !== "FINAL") appendError("SETTLED requires finality=FINAL");
    if (value.refundYen !== 0) appendError("SETTLED requires refundYen=0");
    if (value.refundReason !== null) appendError("SETTLED requires refundReason=null");
  }
  if (value.disposition === "REFUNDED") {
    if (value.finality !== "FINAL") appendError("REFUNDED requires finality=FINAL");
    if (!isSafeNonNegativeInteger(value.refundYen) || value.refundYen === 0) appendError("REFUNDED requires refundYen greater than 0");
    if (!isNonEmptyString(value.refundReason)) appendError("REFUNDED requires refundReason");
    if (value.evaluable !== false) appendError("REFUNDED must not be evaluable by default");
  }
  if (value.disposition === "VOID") {
    if (value.finality !== "VOID") appendError("VOID disposition requires finality=VOID");
    if (value.evaluable !== false) appendError("VOID must not be evaluable");
    if (!isNonEmptyString(value.refundReason)) appendError("VOID requires an explicit reason");
  }
  if (value.evaluable === true && value.finality !== "FINAL") appendError("evaluable outcome requires finality=FINAL");
  return validationResult(errors.length === 0, errors);
}
