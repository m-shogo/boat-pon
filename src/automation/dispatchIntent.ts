// boat-pon dispatch intent → canonical request。
//
// ChatGPT Scheduled Task には SHA-256 計算をさせない。ChatGPT は最小の intent
// （taskId / action / safety / expectedAuthoritySha / maxDuration / reference）だけを commit する。
// queueDigest / requestDigest / canonical request の生成は GitHub 側 guard が行う。
import { createHash } from "node:crypto";
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
const TASKID_RE = /^(TASK-[0-9A-Za-z._-]{1,64}|NEXT)$/;

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
  if (!["L0", "L1", "L2", "L3"].includes(raw.safetyLevel as string)) errors.push("invalid safetyLevel (L4 never; use L0/L1/L2/L3)");
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
};

function isValidUniqueStringIdArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((id) => typeof id === "string" && id.length > 0)
    && new Set(value).size === value.length;
}

export function isIntentProcessed(ledger: ProcessedIntentLedger | null, intentId: string): boolean {
  if (!ledger) return false;
  // A present-but-malformed replay ledger must never be interpreted as "not processed".
  if (!isValidUniqueStringIdArray((ledger as unknown as Record<string, unknown>).intentIds)) return true;
  return ledger.intentIds.includes(intentId);
}
export function isRequestReplay(ledger: ProcessedRequestLedger | null, requestId: string): boolean {
  if (!ledger) return false;
  // Fail closed on structural corruption so a broken ledger cannot reopen a request.
  if (!isValidUniqueStringIdArray((ledger as unknown as Record<string, unknown>).requestIds)) return true;
  return ledger.requestIds.includes(requestId);
}
// 同じ idempotency key の PASS/CONDITIONAL/DRY_RUN_OK 結果があれば再実行しない。
export function findIdempotentSuccess(ledger: ProcessedRequestLedger | null, key: string): { requestId: string; result: string; evidencePath?: string } | null {
  const hit = ledger?.idempotencyKeys?.[key];
  if (hit && ["PASS", "CONDITIONAL", "DRY_RUN_OK"].includes(hit.result)) return hit;
  return null;
}
