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
  if (typeof input.createdAt !== "string" || Number.isNaN(Date.parse(input.createdAt))) {
    errors.push("invalid createdAt");
  }
  if (typeof input.requestedBy !== "string" || input.requestedBy.trim() === "") {
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

export function analyzeEquivalentUnprocessedIntents(input: {
  currentIntent: DispatchIntent;
  allIntents: DispatchIntent[];
  processedIntentIds: string[];
  supersessions: IntentSupersession[];
  acceptableAuthorityShas: string[];
}): EquivalentIntentAnalysis {
  const processed = new Set(input.processedIntentIds);
  const blockingIntentIds: string[] = [];
  const supersededIntentIds: string[] = [];

  for (const candidate of input.allIntents) {
    if (candidate.intentId === input.currentIntent.intentId) continue;
    if (candidate.taskId !== input.currentIntent.taskId) continue;
    if (candidate.requestedAction !== input.currentIntent.requestedAction) continue;
    if (processed.has(candidate.intentId)) continue;

    if (authorityMatches(candidate.expectedAuthoritySha, input.acceptableAuthorityShas)) {
      blockingIntentIds.push(candidate.intentId);
      continue;
    }

    const superseded = input.supersessions.some((record) =>
      record.taskId === input.currentIntent.taskId &&
      record.replacementIntentId === input.currentIntent.intentId &&
      authorityMatches(record.observedAuthoritySha, input.acceptableAuthorityShas) &&
      record.supersededIntents.some((entry) =>
        entry.intentId === candidate.intentId &&
        entry.expectedAuthoritySha === candidate.expectedAuthoritySha &&
        entry.reason === "AUTHORITY_SHA_MISMATCH",
      ),
    );

    if (superseded) supersededIntentIds.push(candidate.intentId);
    else blockingIntentIds.push(candidate.intentId);
  }

  return {
    blockingIntentIds: blockingIntentIds.sort(),
    supersededIntentIds: supersededIntentIds.sort(),
  };
}
