// boat-pon dispatch intent → canonical request。
//
// ChatGPT Scheduled Task には SHA-256 計算をさせない。ChatGPT は最小の intent
// （taskId / action / safety / expectedAuthoritySha / maxDuration / reference）だけを commit する。
// queueDigest / requestDigest / canonical request の生成は GitHub 側 guard が行う。
import { createHash } from "node:crypto";
import { canonicalUtcTimestamp } from "../research-replay/canonical";
import { computeRequestDigest, type TaskRequest } from "./researchOrchestrator";
import type { MergedTask } from "./taskCatalog";

export const INTENT_SCHEMA_VERSION = "research-dispatch-intent-v1";
export const REQUEST_SCHEMA_VERSION = "research-task-request-v1";

export const INTENT_ACTIONS = ["run-task", "dry-run", "plan-next"] as const;
export type IntentAction = (typeof INTENT_ACTIONS)[number];

export type DispatchIntent = {
  intentSchemaVersion: string;
  intentId: string;
  taskId: string;
  requestedAction: IntentAction;
  safetyLevel: "L0" | "L1" | "L2" | "L3";
  expectedAuthoritySha: string;
  maxDurationSeconds: number;
  requestedBy: string;
  requestReference: string;
  approvalGrantId?: string;
};

const REQUIRED = [
  "intentSchemaVersion", "intentId", "taskId", "requestedAction", "safetyLevel",
  "expectedAuthoritySha", "maxDurationSeconds", "requestedBy", "requestReference",
] as const;
const OPTIONAL = ["approvalGrantId"] as const;
const ALLOWED = new Set<string>([...REQUIRED, ...OPTIONAL]);

export const INTENT_ID_RE = /^INTENT-[0-9A-Za-z._-]{4,64}$/;
const REQUEST_ID_RE = /^REQ-[0-9A-Za-z._-]{4,64}$/;
const TASKID_RE = /^(TASK-[0-9A-Za-z._-]{1,64}|NEXT)$/;
const AUTOMATION_HISTORY_PATH_RE = /^reports\/automation\/history\/[0-9A-Za-z._-]+-TASK-[0-9A-Za-z._-]+\.json$/;
const RFC3339_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const isValidTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !RFC3339_TIMESTAMP_RE.test(value)) return false;
  try {
    canonicalUtcTimestamp(value);
    return true;
  } catch {
    return false;
  }
};
const PROCESSED_RESULTS = new Set(["PASS", "DRY_RUN_OK", "CONDITIONAL", "BLOCKED", "FAILED", "FAILED_RETRYABLE", "FAILED_FINAL"]);
const PROCESSED_INTENT_SCHEMA_VERSION = "processed-intents-v1";
const PROCESSED_REQUEST_SCHEMA_VERSION = "processed-requests-v1";
const PROCESSED_INTENT_LEDGER_KEYS = new Set(["ledgerSchemaVersion", "updatedAt", "intentIds", "entries"]);
const PROCESSED_INTENT_ENTRY_KEYS = new Set(["intentId", "requestId", "result", "recordedAt"]);
const PROCESSED_REQUEST_LEDGER_KEYS = new Set(["ledgerSchemaVersion", "updatedAt", "requestIds", "idempotencyKeys"]);
const IDEMPOTENCY_ENTRY_KEYS = new Set(["requestId", "result", "evidencePath", "recordedAt"]);

// strict intent decode。unknown field / hash 系 field はすべて拒否（ChatGPT に hash を作らせない）。
export function validateIntent(input: unknown): { valid: boolean; errors: string[]; intent: DispatchIntent | null } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["intent must be a JSON object"], intent: null };
  }
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!ALLOWED.has(k)) errors.push(`unknown field: ${k}`);
  for (const k of REQUIRED) if (!(k in raw)) errors.push(`missing field: ${k}`);
  if (errors.length > 0) return { valid: false, errors, intent: null };

  if (raw.intentSchemaVersion !== INTENT_SCHEMA_VERSION) errors.push(`intentSchemaVersion must be ${INTENT_SCHEMA_VERSION}`);
  if (typeof raw.intentId !== "string" || !INTENT_ID_RE.test(raw.intentId)) errors.push("invalid intentId");
  if (typeof raw.taskId !== "string" || !TASKID_RE.test(raw.taskId)) errors.push("invalid taskId");
  if (!INTENT_ACTIONS.includes(raw.requestedAction as IntentAction)) errors.push("invalid requestedAction");
  if (raw.requestedAction === "plan-next" && raw.taskId !== "NEXT") errors.push("plan-next requires taskId NEXT");
  if (!["L0", "L1", "L2", "L3"].includes(raw.safetyLevel as string)) errors.push("invalid safetyLevel (L4 never; use L0/L1/L2/L3)");
  if (raw.safetyLevel === "L3" && !("approvalGrantId" in raw)) errors.push("L3 requires approvalGrantId");
  if (typeof raw.expectedAuthoritySha !== "string" || !/^[0-9a-f]{7,40}$/.test(raw.expectedAuthoritySha)) errors.push("invalid expectedAuthoritySha");
  if (!Number.isInteger(raw.maxDurationSeconds) || (raw.maxDurationSeconds as number) < 60 || (raw.maxDurationSeconds as number) > 21600) errors.push("invalid maxDurationSeconds");
  if (typeof raw.requestedBy !== "string" || raw.requestedBy.trim() === "") errors.push("invalid requestedBy");
  if (typeof raw.requestReference !== "string" || raw.requestReference.trim() === "") errors.push("invalid requestReference");
  if ("approvalGrantId" in raw && (typeof raw.approvalGrantId !== "string" || raw.approvalGrantId.trim() === "")) errors.push("invalid approvalGrantId");
  if (errors.length > 0) return { valid: false, errors, intent: null };
  return { valid: true, errors: [], intent: raw as unknown as DispatchIntent };
}

// idempotency key: 同じ意味の再実行を検出するための安定 key。
// task / 定義版 / authority / state 版 / executor 版 / input 恒等 / safety を含める。
export function computeIdempotencyKey(parts: {
  taskId: string;
  taskDefinitionVersion: number;
  authoritySha: string;
  stateVersion: number;
  executorVersion: string;
  inputIdentity: string;
  safetyLevel: string;
}): string {
  const canonical = [
    parts.taskId, String(parts.taskDefinitionVersion), parts.authoritySha,
    String(parts.stateVersion), parts.executorVersion, parts.inputIdentity, parts.safetyLevel,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export type CanonicalRequestInput = {
  intent: DispatchIntent;
  authoritySha: string;      // guard が確認した最新 main SHA
  queueDigest: string;       // guard が state から計算した digest
  createdAt: string;         // guard が付与
  task: MergedTask;          // catalog の task 定義（expectedOutput / safety の正本）
};

// intent の「意味」を変えずに canonical request を生成する。
// taskId / requestedAction / safetyLevel を別値へ変換しない（intent が正）。
export function buildCanonicalRequest(input: CanonicalRequestInput): { request: TaskRequest; errors: string[] } {
  const { intent, task } = input;
  const errors: string[] = [];
  // intent と catalog の safety 整合（intent が catalog より緩い safety を主張したら拒否）。
  const order = ["L0", "L1", "L2", "L3", "L4"];
  if (order.indexOf(intent.safetyLevel) < order.indexOf(task.safetyLevel)) {
    errors.push(`intent safety ${intent.safetyLevel} is below catalog safety ${task.safetyLevel}`);
  }
  if (intent.maxDurationSeconds > task.maxDurationSeconds) {
    errors.push(`intent maxDurationSeconds ${intent.maxDurationSeconds} exceeds catalog maxDurationSeconds ${task.maxDurationSeconds}`);
  }
  const requestedAction = intent.requestedAction === "plan-next" ? "run-task" : intent.requestedAction;
  const requestId = `REQ-${intent.intentId.replace(/^INTENT-/, "")}`;
  const base: Omit<TaskRequest, "requestDigest"> = {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    requestId,
    taskId: intent.taskId,
    requestedAction: requestedAction as TaskRequest["requestedAction"],
    safetyLevel: intent.safetyLevel,
    authoritySha: input.authoritySha,
    queueDigest: input.queueDigest,
    createdAt: input.createdAt,
    requestedBy: intent.requestedBy,
    maxDurationSeconds: intent.maxDurationSeconds,
    expectedOutput: task.expectedOutputs[0] ?? "reports/automation/current-status.json",
    approvalRequirement: intent.safetyLevel === "L3" ? "existing-grant-required" : "none",
    requestReference: intent.requestReference,
    ...(intent.approvalGrantId ? { approvalGrantId: intent.approvalGrantId } : {}),
    ...(intent.requestedAction === "dry-run" ? { dryRun: true } : {}),
  };
  const requestDigest = computeRequestDigest(base as Record<string, unknown>);
  return { request: { ...base, requestDigest }, errors };
}

// processed ledger 型（automation branch の正本）。
export type ProcessedIntentLedger = { intentIds: string[]; entries?: Record<string, unknown>[] };
export type ProcessedRequestLedger = {
  requestIds: string[];
  idempotencyKeys: Record<string, { requestId: string; result: string; evidencePath?: string; recordedAt: string }>;
  updatedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasValidOptionalMetadata(raw: Record<string, unknown>, schemaVersion: string): boolean {
  if ("ledgerSchemaVersion" in raw && raw.ledgerSchemaVersion !== schemaVersion) return false;
  if ("updatedAt" in raw && !isValidTimestamp(raw.updatedAt)) return false;
  return true;
}

function isValidUniqueIdArray(value: unknown, pattern: RegExp): value is string[] {
  return Array.isArray(value)
    && value.every((id) => typeof id === "string" && pattern.test(id))
    && new Set(value).size === value.length;
}

function isProcessedIntentLedgerValid(ledger: ProcessedIntentLedger): boolean {
  const raw = ledger as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(raw, PROCESSED_INTENT_LEDGER_KEYS) || !hasValidOptionalMetadata(raw, PROCESSED_INTENT_SCHEMA_VERSION)) return false;
  if (!isValidUniqueIdArray(raw.intentIds, INTENT_ID_RE)) return false;
  if (!("entries" in raw) || raw.entries === undefined) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length !== ledger.intentIds.length) return false;

  const seen = new Set<string>();
  for (const [index, value] of raw.entries.entries()) {
    if (!isRecord(value)
      || !hasOnlyKeys(value, PROCESSED_INTENT_ENTRY_KEYS)
      || typeof value.intentId !== "string" || !INTENT_ID_RE.test(value.intentId)
      || value.intentId !== ledger.intentIds[index]
      || typeof value.requestId !== "string" || value.requestId !== `REQ-${value.intentId.replace(/^INTENT-/, "")}`
      || typeof value.result !== "string" || !PROCESSED_RESULTS.has(value.result)
      || !isValidTimestamp(value.recordedAt)) {
      return false;
    }
    if (seen.has(value.intentId) || !ledger.intentIds.includes(value.intentId)) return false;
    seen.add(value.intentId);
  }
  return seen.size === ledger.intentIds.length;
}

export function isIntentProcessed(ledger: ProcessedIntentLedger | null, intentId: string): boolean {
  if (!ledger) return true;
  // A missing or malformed replay ledger must never be interpreted as "not processed".
  if (!isProcessedIntentLedgerValid(ledger)) return true;
  return ledger.intentIds.includes(intentId);
}
export function isRequestReplay(ledger: ProcessedRequestLedger | null, requestId: string): boolean {
  if (!ledger) return true;
  // Replay checks must fail closed on missing/corrupt requestIds or idempotency state.
  try {
    assertIdempotencyLedgerValid(ledger);
  } catch {
    return true;
  }
  return ledger.requestIds.includes(requestId);
}

function assertIdempotencyLedgerValid(ledger: ProcessedRequestLedger): void {
  const raw = ledger as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(raw, PROCESSED_REQUEST_LEDGER_KEYS) || !hasValidOptionalMetadata(raw, PROCESSED_REQUEST_SCHEMA_VERSION)) {
    throw new Error("malformed processed request ledger: metadata or unknown field");
  }
  if (!isValidUniqueIdArray(raw.requestIds, REQUEST_ID_RE)) {
    throw new Error("malformed processed request ledger: requestIds");
  }
  if (!isRecord(raw.idempotencyKeys)) {
    throw new Error("malformed processed request ledger: idempotencyKeys");
  }
  const seenIdempotencyRequestIds = new Set<string>();
  for (const [key, value] of Object.entries(raw.idempotencyKeys)) {
    if (!/^[0-9a-f]{64}$/.test(key) || !isRecord(value) || !hasOnlyKeys(value, IDEMPOTENCY_ENTRY_KEYS)) {
      throw new Error("malformed processed request ledger: idempotency entry");
    }
    if (typeof value.requestId !== "string" || !REQUEST_ID_RE.test(value.requestId)
      || typeof value.result !== "string" || !PROCESSED_RESULTS.has(value.result)
      || !isValidTimestamp(value.recordedAt)
      || ("evidencePath" in value && (typeof value.evidencePath !== "string" || !AUTOMATION_HISTORY_PATH_RE.test(value.evidencePath)))) {
      throw new Error("malformed processed request ledger: idempotency entry");
    }
    if (seenIdempotencyRequestIds.has(value.requestId)) {
      throw new Error("malformed processed request ledger: duplicate requestId provenance");
    }
    seenIdempotencyRequestIds.add(value.requestId);
    if (!ledger.requestIds.includes(value.requestId)) {
      throw new Error("malformed processed request ledger: idempotency requestId not recorded");
    }
  }
}

// A completed intent is only durable when its canonical request is also present in the
// processed-request ledger. The reverse is intentionally not required because legacy
// request-only history predates the intent ledger.
export function assertReplayLedgersConsistent(
  intents: ProcessedIntentLedger | null,
  requests: ProcessedRequestLedger | null,
): void {
  if (!intents) throw new Error("missing processed intent ledger");
  if (!isProcessedIntentLedgerValid(intents)) throw new Error("malformed processed intent ledger");
  if (!requests) throw new Error("missing processed request ledger");
  assertIdempotencyLedgerValid(requests);

  const requestIds = new Set(requests.requestIds);
  const provenanceResults = new Map(
    Object.values(requests.idempotencyKeys).map((entry) => [entry.requestId, entry.result] as const),
  );
  for (const entry of intents.entries as Record<string, unknown>[]) {
    const requestId = entry.requestId as string;
    if (!requestIds.has(requestId)) {
      throw new Error("cross-ledger mismatch: processed intent requestId not recorded");
    }
    const provenanceResult = provenanceResults.get(requestId);
    if (provenanceResult !== undefined && provenanceResult !== entry.result) {
      throw new Error("cross-ledger mismatch: processed intent result differs from request provenance");
    }
  }
}

// 同じ idempotency key の PASS/CONDITIONAL/DRY_RUN_OK 結果があれば再実行しない。
export function findIdempotentSuccess(ledger: ProcessedRequestLedger | null, key: string): { requestId: string; result: string; evidencePath?: string } | null {
  if (!ledger) throw new Error("missing processed request ledger");
  // run-intent-task calls this before executor invocation; throwing here blocks execution on ledger corruption.
  assertIdempotencyLedgerValid(ledger);
  const hit = ledger.idempotencyKeys[key];
  if (hit && ["PASS", "CONDITIONAL", "DRY_RUN_OK"].includes(hit.result)) return hit;
  return null;
}
