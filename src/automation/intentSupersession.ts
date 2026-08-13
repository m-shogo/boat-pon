import type { DispatchIntent } from "./dispatchIntent";

export const INTENT_SUPERSESSION_SCHEMA_VERSION = "research-intent-supersession-v1";
export const INTENT_SUPERSESSION_REASONS = ["AUTHORITY_SHA_MISMATCH"] as const;

export type IntentSupersessionReason = (typeof INTENT_SUPERSESSION_REASONS)[number];

export type SupersededIntentReference = {
  intentId: string;
  expectedAuthoritySha: string;
  reason: IntentSupersessionReason;
};

export type IntentSupersession = {
  supersessionSchemaVersion: typeof INTENT_SUPERSESSION_SCHEMA_VERSION;
  supersessionId: string;
  taskId: string;
  replacementIntentId: string;
  supersededIntents: SupersededIntentReference[];
  observedAuthoritySha: string;
  createdAt: string;
  requestedBy: string;
};

const INTENT_ID_RE = /^INTENT-[0-9A-Za-z._-]{4,64}$/;
const SUPERSESSION_ID_RE = /^SUPERSESSION-[0-9A-Za-z._-]{4,96}$/;
const TASK_ID_RE = /^(TASK-[0-9A-Za-z._-]{1,64}|NEXT)$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const RFC3339_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const TOP_LEVEL_KEYS = new Set([
  "supersessionSchemaVersion",
  "supersessionId",
  "taskId",
  "replacementIntentId",
  "supersededIntents",
  "observedAuthoritySha",
  "createdAt",
  "requestedBy",
]);
const ENTRY_KEYS = new Set(["intentId", "expectedAuthoritySha", "reason"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function authorityMatches(expectedAuthoritySha: string, acceptableAuthorityShas: string[]): boolean {
  return acceptableAuthorityShas.some(
    (sha) => sha.startsWith(expectedAuthoritySha) || expectedAuthoritySha.startsWith(sha),
  );
}

export function validateIntentSupersession(
  input: unknown,
): { valid: boolean; errors: string[]; supersession: IntentSupersession | null } {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { valid: false, errors: ["supersession must be a JSON object"], supersession: null };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (!(key in input)) errors.push(`missing field: ${key}`);
  }
  if (errors.length > 0) return { valid: false, errors, supersession: null };

  if (input.supersessionSchemaVersion !== INTENT_SUPERSESSION_SCHEMA_VERSION) {
    errors.push(`supersessionSchemaVersion must be ${INTENT_SUPERSESSION_SCHEMA_VERSION}`);
  }
  if (typeof input.supersessionId !== "string" || !SUPERSESSION_ID_RE.test(input.supersessionId)) {
    errors.push("invalid supersessionId");
  }
  if (typeof input.taskId !== "string" || !TASK_ID_RE.test(input.taskId)) errors.push("invalid taskId");
  if (typeof input.replacementIntentId !== "string" || !INTENT_ID_RE.test(input.replacementIntentId)) {
    errors.push("invalid replacementIntentId");
  }
  if (typeof input.observedAuthoritySha !== "string" || !/^[0-9a-f]{40}$/.test(input.observedAuthoritySha)) {
    errors.push("observedAuthoritySha must be a full 40-character SHA");
  }
  if (
    typeof input.createdAt !== "string" ||
    !RFC3339_DATE_TIME_RE.test(input.createdAt) ||
    !hasValidCalendarDate(input.createdAt) ||
    Number.isNaN(Date.parse(input.createdAt))
  ) {
    errors.push("invalid createdAt");
  }
  if (typeof input.requestedBy !== "string" || input.requestedBy.trim() === "" || input.requestedBy.length > 128) {
    errors.push("invalid requestedBy");
  }

  if (!Array.isArray(input.supersededIntents) || input.supersededIntents.length < 1 || input.supersededIntents.length > 20) {
    errors.push("supersededIntents must contain 1..20 entries");
  } else {
    const seen = new Set<string>();
    for (const [index, entry] of input.supersededIntents.entries()) {
      if (!isRecord(entry)) {
        errors.push(`supersededIntents[${index}] must be an object`);
        continue;
      }
      for (const key of Object.keys(entry)) {
        if (!ENTRY_KEYS.has(key)) errors.push(`unknown field: supersededIntents[${index}].${key}`);
      }
      for (const key of ENTRY_KEYS) {
        if (!(key in entry)) errors.push(`missing field: supersededIntents[${index}].${key}`);
      }
      if (typeof entry.intentId !== "string" || !INTENT_ID_RE.test(entry.intentId)) {
        errors.push(`invalid supersededIntents[${index}].intentId`);
      } else {
        if (seen.has(entry.intentId)) errors.push(`duplicate superseded intentId: ${entry.intentId}`);
        seen.add(entry.intentId);
        if (entry.intentId === input.replacementIntentId) errors.push("replacement intent cannot supersede itself");
      }
      if (typeof entry.expectedAuthoritySha !== "string" || !SHA_RE.test(entry.expectedAuthoritySha)) {
        errors.push(`invalid supersededIntents[${index}].expectedAuthoritySha`);
      }
      if (!INTENT_SUPERSESSION_REASONS.includes(entry.reason as IntentSupersessionReason)) {
        errors.push(`invalid supersededIntents[${index}].reason`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors, supersession: null };
  return { valid: true, errors: [], supersession: input as unknown as IntentSupersession };
}

export type EquivalentIntentAnalysis = {
  blockingIntentIds: string[];
  supersededIntentIds: string[];
};

function hasDurableSupersession(input: {
  candidate: DispatchIntent;
  allIntentsById: Map<string, DispatchIntent>;
  supersessions: IntentSupersession[];
}): boolean {
  return input.supersessions.some((record) => {
    if (record.taskId !== input.candidate.taskId) return false;
    const replacement = input.allIntentsById.get(record.replacementIntentId);
    if (!replacement) return false;
    if (replacement.intentId === input.candidate.intentId) return false;
    if (replacement.taskId !== input.candidate.taskId) return false;
    if (replacement.requestedAction !== input.candidate.requestedAction) return false;
    if (replacement.safetyLevel !== input.candidate.safetyLevel) return false;
    if (replacement.maxDurationSeconds !== input.candidate.maxDurationSeconds) return false;
    if ((replacement.approvalGrantId ?? null) !== (input.candidate.approvalGrantId ?? null)) return false;
    if (!authorityMatches(replacement.expectedAuthoritySha, [record.observedAuthoritySha])) return false;
    return record.supersededIntents.some((entry) =>
      entry.intentId === input.candidate.intentId &&
      entry.expectedAuthoritySha === input.candidate.expectedAuthoritySha &&
      entry.reason === "AUTHORITY_SHA_MISMATCH"
    );
  });
}

export function analyzeEquivalentUnprocessedIntents(input: {
  currentIntent: DispatchIntent;
  allIntents: DispatchIntent[];
  processedIntentIds: string[];
  supersessions: IntentSupersession[];
  acceptableAuthorityShas: string[];
}): EquivalentIntentAnalysis {
  const processed = new Set(input.processedIntentIds);
  const allIntentsById = new Map(input.allIntents.map((intent) => [intent.intentId, intent]));
  const blockingIntentIds: string[] = [];
  const supersededIntentIds: string[] = [];

  for (const candidate of input.allIntents) {
    if (candidate.intentId === input.currentIntent.intentId) continue;
    if (candidate.taskId !== input.currentIntent.taskId) continue;
    if (candidate.requestedAction !== input.currentIntent.requestedAction) continue;
    if (processed.has(candidate.intentId)) continue;

    // A still-current equivalent intent is active work and can never be superseded.
    if (authorityMatches(candidate.expectedAuthoritySha, input.acceptableAuthorityShas)) {
      blockingIntentIds.push(candidate.intentId);
      continue;
    }

    // A merged strict supersession is a durable terminal classification. Its validity is
    // anchored to the immutable replacement intent and the authority observed when that
    // replacement was created, not to whatever main SHA happens to be current later.
    if (hasDurableSupersession({ candidate, allIntentsById, supersessions: input.supersessions })) {
      supersededIntentIds.push(candidate.intentId);
    } else {
      blockingIntentIds.push(candidate.intentId);
    }
  }

  return {
    blockingIntentIds: blockingIntentIds.sort(),
    supersededIntentIds: supersededIntentIds.sort(),
  };
}
