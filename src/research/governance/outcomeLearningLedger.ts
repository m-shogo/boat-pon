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

const ALLOWED_FIELDS = new Set<keyof OutcomeLearningLedgerRecord>([
  "schemaVersion", "outcomeRecordId", "decisionRecordId", "decisionId", "canonicalRaceId",
  "ticketType", "selection", "settlementId", "settledAt", "finality", "disposition",
  "evaluable", "stakeYen", "payoutYen", "refundYen", "refundReason", "popularity",
  "sourceEvidenceDigests", "provenanceVersion",
]);
const SHA256_RE = /^[0-9a-f]{64}$/u;
const EXACT_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
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
  if (!match) return false;
  const [, y, mo, d, h, mi, s, oh, om] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  if (month < 1 || month > 12 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > days) return false;
  return oh === undefined || (Number(oh) <= 23 && Number(om) <= 59);
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function outcomeLearningLedgerDigest(record: OutcomeLearningLedgerRecord): string {
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
  if (!input.decisionExact) return "UNRESOLVED_DECISION";
  if (!input.settlementIdentityExact) return "UNRESOLVED_SETTLEMENT_IDENTITY";
  if (!input.ticketLinkExact) return "UNRESOLVED_TICKET_LINK";
  if (!input.refundOrInvalidationExact) return "UNRESOLVED_REFUND_OR_INVALIDATION";
  if (!input.finalityExact) return "UNRESOLVED_FINALITY";
  return "EXACT";
}

export function validateOutcomeLearningLedgerRecord(value: unknown): OutcomeLearningLedgerValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["record must be an object"] };
  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field as keyof OutcomeLearningLedgerRecord)) errors.push(`unknown field is not allowed: ${field}`);
  }
  if (value.schemaVersion !== OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION) errors.push(`schemaVersion must be ${OUTCOME_LEARNING_LEDGER_SCHEMA_VERSION}`);
  for (const field of ["outcomeRecordId", "decisionRecordId", "decisionId", "canonicalRaceId", "ticketType", "selection", "settlementId", "provenanceVersion"] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!isNonEmptyString(value.settledAt) || !isExactInstant(value.settledAt) || !Number.isFinite(Date.parse(value.settledAt))) {
    errors.push("settledAt must be a valid timezone-bound ISO timestamp");
  }
  if (value.finality !== "FINAL" && value.finality !== "VOID") errors.push("finality must be FINAL or VOID");
  if (value.disposition !== "SETTLED" && value.disposition !== "REFUNDED" && value.disposition !== "VOID") errors.push("disposition is invalid");
  if (typeof value.evaluable !== "boolean") errors.push("evaluable must be boolean");
  for (const field of ["stakeYen", "payoutYen", "refundYen"] as const) {
    if (!isSafeNonNegativeInteger(value[field])) errors.push(`${field} must be a non-negative safe integer`);
  }
  if (value.refundReason !== null && !isNonEmptyString(value.refundReason)) errors.push("refundReason must be a non-empty string or null");
  if (value.popularity !== null && (!Number.isSafeInteger(value.popularity) || (value.popularity as number) <= 0)) errors.push("popularity must be a positive safe integer or null");
  if (!Array.isArray(value.sourceEvidenceDigests) || value.sourceEvidenceDigests.length === 0 || value.sourceEvidenceDigests.some((digest) => typeof digest !== "string" || !SHA256_RE.test(digest))) {
    errors.push("sourceEvidenceDigests must contain one or more lowercase SHA-256 digests");
  } else if (new Set(value.sourceEvidenceDigests).size !== value.sourceEvidenceDigests.length) {
    errors.push("sourceEvidenceDigests must not contain duplicates");
  }

  if (value.disposition === "SETTLED") {
    if (value.finality !== "FINAL") errors.push("SETTLED requires finality=FINAL");
    if (value.refundYen !== 0) errors.push("SETTLED requires refundYen=0");
    if (value.refundReason !== null) errors.push("SETTLED requires refundReason=null");
  }
  if (value.disposition === "REFUNDED") {
    if (value.finality !== "FINAL") errors.push("REFUNDED requires finality=FINAL");
    if (!isSafeNonNegativeInteger(value.refundYen) || value.refundYen === 0) errors.push("REFUNDED requires refundYen greater than 0");
    if (!isNonEmptyString(value.refundReason)) errors.push("REFUNDED requires refundReason");
    if (value.evaluable !== false) errors.push("REFUNDED must not be evaluable by default");
  }
  if (value.disposition === "VOID") {
    if (value.finality !== "VOID") errors.push("VOID disposition requires finality=VOID");
    if (value.evaluable !== false) errors.push("VOID must not be evaluable");
    if (!isNonEmptyString(value.refundReason)) errors.push("VOID requires an explicit reason");
  }
  if (value.evaluable === true && value.finality !== "FINAL") errors.push("evaluable outcome requires finality=FINAL");
  return { valid: errors.length === 0, errors };
}
