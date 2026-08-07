import { createHash } from "node:crypto";

export const RESEARCH_AUTOMATION_FAILURE_HISTORY_VERSION =
  "research-automation-failure-history-v1" as const;

const SHA256_RE = /^[0-9a-f]{64}$/u;
const GIT_SHA_RE = /^[0-9a-f]{40}$/u;
const RUN_ID_RE = /^[0-9]+$/u;
const TASK_ID_RE = /^TASK-[0-9A-Za-z._-]+$/u;

export type ResearchAutomationFailureResult = "BLOCKED" | "FAILED";

export type ResearchAutomationFailureHistory = {
  runId: string;
  requestId: string;
  intentId: string;
  taskId: string;
  taskType: string;
  safetyLevel: "L0" | "L1" | "L2" | "L3";
  executorVersion: string;
  executed: true;
  result: ResearchAutomationFailureResult;
  blocks: string[];
  outputs: [];
  outputDigest: string;
  summary: {
    historyContractVersion: typeof RESEARCH_AUTOMATION_FAILURE_HISTORY_VERSION;
    failureCode: string;
    finalTaskStatus: string;
    message: string | null;
  };
  authoritySha: string;
  idempotencyKey: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function iso(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return new Date(parsed).toISOString();
}

function nonEmpty(value: string, code: string): string {
  if (!value.trim()) throw new Error(code);
  return value;
}

export function buildResearchAutomationFailureHistory(input: {
  runId: string;
  requestId: string;
  intentId: string;
  taskId: string;
  taskType: string;
  safetyLevel: "L0" | "L1" | "L2" | "L3";
  executorVersion: string;
  result: ResearchAutomationFailureResult;
  failureCode: string;
  finalTaskStatus: string;
  message?: string | null;
  authoritySha: string;
  idempotencyKey: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
}): ResearchAutomationFailureHistory {
  if (!RUN_ID_RE.test(input.runId)) throw new Error("FAILURE_HISTORY_RUN_ID_INVALID");
  if (!TASK_ID_RE.test(input.taskId)) throw new Error("FAILURE_HISTORY_TASK_ID_INVALID");
  nonEmpty(input.requestId, "FAILURE_HISTORY_REQUEST_ID_INVALID");
  nonEmpty(input.intentId, "FAILURE_HISTORY_INTENT_ID_INVALID");
  nonEmpty(input.taskType, "FAILURE_HISTORY_TASK_TYPE_INVALID");
  nonEmpty(input.executorVersion, "FAILURE_HISTORY_EXECUTOR_VERSION_INVALID");
  nonEmpty(input.failureCode, "FAILURE_HISTORY_FAILURE_CODE_INVALID");
  nonEmpty(input.finalTaskStatus, "FAILURE_HISTORY_FINAL_STATUS_INVALID");
  if (!/^L[0-3]$/u.test(input.safetyLevel)) throw new Error("FAILURE_HISTORY_SAFETY_LEVEL_INVALID");
  if (!GIT_SHA_RE.test(input.authoritySha)) throw new Error("FAILURE_HISTORY_AUTHORITY_SHA_INVALID");
  if (!SHA256_RE.test(input.idempotencyKey)) throw new Error("FAILURE_HISTORY_IDEMPOTENCY_KEY_INVALID");
  if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0) throw new Error("FAILURE_HISTORY_ELAPSED_MS_INVALID");

  const startedAt = iso(input.startedAt, "FAILURE_HISTORY_STARTED_AT_INVALID");
  const completedAt = iso(input.completedAt, "FAILURE_HISTORY_COMPLETED_AT_INVALID");
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error("FAILURE_HISTORY_TIME_ORDER_INVALID");
  const message = input.message == null ? null : input.message.slice(0, 300);
  const summary = {
    historyContractVersion: RESEARCH_AUTOMATION_FAILURE_HISTORY_VERSION,
    failureCode: input.failureCode,
    finalTaskStatus: input.finalTaskStatus,
    message,
  };

  return {
    runId: input.runId,
    requestId: input.requestId,
    intentId: input.intentId,
    taskId: input.taskId,
    taskType: input.taskType,
    safetyLevel: input.safetyLevel,
    executorVersion: input.executorVersion,
    executed: true,
    result: input.result,
    blocks: [input.failureCode],
    outputs: [],
    outputDigest: digest(summary),
    summary,
    authoritySha: input.authoritySha,
    idempotencyKey: input.idempotencyKey,
    startedAt,
    completedAt,
    elapsedMs: input.elapsedMs,
  };
}
