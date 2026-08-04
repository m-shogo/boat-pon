// boat-pon one-shot research orchestrator（1 request = 1 task、ループ・daemon なし）。
//
// ChatGPT Scheduled Task / operator が GitHub 経由で依頼した「1 回分」の task を、
// self-hosted runner 上で安全に実行するための純粋ロジック層。
// 本モジュールは schedule / cron / daemon / watch を一切持たない（禁止）。
import { createHash } from "node:crypto";

export const REQUEST_SCHEMA_VERSION = "research-task-request-v1";
export const ORCHESTRATOR_VERSION = "research-orchestrator-v1";
export const STATUS_SCHEMA_VERSION = "research-automation-status-v1";

export const SAFETY_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export const TASK_STATUSES = [
  "READY", "CLAIMED", "RUNNING", "CHECKPOINTED", "PASS", "CONDITIONAL",
  "BLOCKED", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const REQUESTED_ACTIONS = ["run-task", "run-next", "status-only", "dry-run"] as const;
export type RequestedAction = (typeof REQUESTED_ACTIONS)[number];

export type TaskRequest = {
  requestSchemaVersion: string;
  requestId: string;
  taskId: string;
  requestedAction: RequestedAction;
  safetyLevel: SafetyLevel;
  authoritySha: string;
  queueDigest: string;
  createdAt: string;
  requestedBy: string;
  maxDurationSeconds: number;
  expectedOutput: string;
  approvalRequirement: "none" | "existing-grant-required";
  approvalGrantId?: string;
  requestReference?: string;
  dryRun?: boolean;
  requestDigest: string;
};

const REQUIRED_FIELDS = [
  "requestSchemaVersion", "requestId", "taskId", "requestedAction", "safetyLevel",
  "authoritySha", "queueDigest", "createdAt", "requestedBy", "maxDurationSeconds",
  "expectedOutput", "approvalRequirement", "requestDigest",
] as const;
const OPTIONAL_FIELDS = ["approvalGrantId", "requestReference", "dryRun"] as const;
const ALLOWED_FIELDS = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

// request digest は requestDigest 自身を除く canonical JSON の SHA-256。
export function computeRequestDigest(request: Record<string, unknown>): string {
  const { requestDigest: _omit, ...rest } = request as Record<string, unknown> & { requestDigest?: unknown };
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export type RequestValidation = {
  valid: boolean;
  errors: string[];
  request: TaskRequest | null;
};

// strict decode: unknown field / missing field / 形式不正 / digest 不一致はすべて拒否（fail-closed）。
export function validateRequest(input: unknown): RequestValidation {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["request must be a JSON object"], request: null };
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!ALLOWED_FIELDS.has(key)) errors.push(`unknown field: ${key}`);
  for (const key of REQUIRED_FIELDS) if (!(key in raw)) errors.push(`missing field: ${key}`);
  if (errors.length > 0) return { valid: false, errors, request: null };

  if (raw.requestSchemaVersion !== REQUEST_SCHEMA_VERSION) errors.push(`requestSchemaVersion must be ${REQUEST_SCHEMA_VERSION}`);
  if (typeof raw.requestId !== "string" || !/^REQ-[0-9A-Za-z._-]{4,64}$/.test(raw.requestId)) errors.push("invalid requestId");
  if (typeof raw.taskId !== "string" || !/^(TASK-[0-9A-Za-z._-]{1,64}|NEXT)$/.test(raw.taskId)) errors.push("invalid taskId");
  if (!REQUESTED_ACTIONS.includes(raw.requestedAction as RequestedAction)) errors.push("invalid requestedAction");
  if (!SAFETY_LEVELS.includes(raw.safetyLevel as SafetyLevel)) errors.push("invalid safetyLevel");
  if (typeof raw.authoritySha !== "string" || !/^[0-9a-f]{7,40}$/.test(raw.authoritySha)) errors.push("invalid authoritySha");
  if (typeof raw.queueDigest !== "string" || !/^[0-9a-f]{64}$/.test(raw.queueDigest)) errors.push("invalid queueDigest");
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) errors.push("invalid createdAt");
  if (typeof raw.requestedBy !== "string" || raw.requestedBy.trim() === "") errors.push("invalid requestedBy");
  if (!Number.isInteger(raw.maxDurationSeconds) || (raw.maxDurationSeconds as number) < 60 || (raw.maxDurationSeconds as number) > 21600) errors.push("invalid maxDurationSeconds");
  if (typeof raw.expectedOutput !== "string" || raw.expectedOutput.trim() === "") errors.push("invalid expectedOutput");
  if (raw.approvalRequirement !== "none" && raw.approvalRequirement !== "existing-grant-required") errors.push("invalid approvalRequirement");
  if (typeof raw.requestDigest !== "string" || !/^[0-9a-f]{64}$/.test(raw.requestDigest)) errors.push("invalid requestDigest");
  if ("dryRun" in raw && typeof raw.dryRun !== "boolean") errors.push("dryRun must be boolean");
  if (errors.length > 0) return { valid: false, errors, request: null };

  const expected = computeRequestDigest(raw);
  if (expected !== raw.requestDigest) errors.push(`requestDigest mismatch: expected ${expected}`);
  if (errors.length > 0) return { valid: false, errors, request: null };
  return { valid: true, errors: [], request: raw as unknown as TaskRequest };
}

export type SafetyDecision = {
  allowed: boolean;
  code: "ALLOWED" | "L4_FORBIDDEN" | "L3_REQUIRES_GRANT" | "LEVEL_NOT_ALLOWED";
  reason: string;
  exitCode: 0 | 2 | 3;
};

// safety level 判定。L4 は常時拒否。L3 は有効な事前 grant が無ければ exit 3 で BLOCK。
export function decideSafety(
  level: SafetyLevel,
  policy: { allowedSafetyLevels: string[]; deniedSafetyLevels: string[] },
  grant: { present: boolean; valid: boolean } = { present: false, valid: false },
): SafetyDecision {
  if (level === "L4") {
    return { allowed: false, code: "L4_FORBIDDEN", reason: "L4 (BUY/prediction/betting/credentials/irreversible) is never automated", exitCode: 3 };
  }
  if (level === "L3") {
    if (!grant.present || !grant.valid) {
      return { allowed: false, code: "L3_REQUIRES_GRANT", reason: "L3 requires a pre-existing valid approval grant", exitCode: 3 };
    }
    return { allowed: true, code: "ALLOWED", reason: "L3 permitted by an existing valid grant", exitCode: 0 };
  }
  if (policy.deniedSafetyLevels.includes(level)) {
    return { allowed: false, code: "LEVEL_NOT_ALLOWED", reason: `safety level ${level} is denied by policy`, exitCode: 3 };
  }
  if (!policy.allowedSafetyLevels.includes(level)) {
    return { allowed: false, code: "LEVEL_NOT_ALLOWED", reason: `safety level ${level} is not in the policy allowlist`, exitCode: 3 };
  }
  return { allowed: true, code: "ALLOWED", reason: `safety level ${level} allowed by policy`, exitCode: 0 };
}

// automation 自身が生成する成果物 path。dirty 判定から除外する（自分の前回出力で
// 次回実行が永久に BLOCK されるのを防ぐ）。これ以外の変更は従来どおり DIRTY_WORKING_TREE。
export const AUTOMATION_OUTPUT_PREFIXES = ["reports/automation/", "automation/task-queue.json", "automation/requests/"] as const;
export function isAutomationOutputPath(path: string): boolean {
  return AUTOMATION_OUTPUT_PREFIXES.some((p) => path === p || path.startsWith(p));
}
/** git status --porcelain の path 一覧から、automation 出力以外の変更だけを返す。 */
export function foreignDirtyPaths(paths: string[]): string[] {
  return paths.filter((p) => p !== "" && !isAutomationOutputPath(p));
}

export type PreflightInput = {
  emergencyStop: boolean;
  paused: boolean;
  workingTreeClean: boolean;
  localHeadSha: string;
  originHeadSha: string;
  activeWal: boolean;
  freeDiskBytes: number;
  minFreeDiskBytes: number;
  queueDigest: string;
  requestQueueDigest: string;
  authoritySha: string;
  alreadyProcessedRequestIds: string[];
  requestId: string;
};
export type PreflightResult = { ok: boolean; blocks: string[] };

// 実行前 guard を集約する（すべて fail-closed）。
export function preflight(input: PreflightInput): PreflightResult {
  const blocks: string[] = [];
  if (input.emergencyStop) blocks.push("EMERGENCY_STOP_ACTIVE");
  if (input.paused) blocks.push("AUTOMATION_PAUSED");
  if (!input.workingTreeClean) blocks.push("DIRTY_WORKING_TREE");
  if (input.localHeadSha !== input.originHeadSha) blocks.push("GIT_DRIFT_LOCAL_VS_ORIGIN");
  if (!input.localHeadSha.startsWith(input.authoritySha) && !input.authoritySha.startsWith(input.localHeadSha)) {
    blocks.push("AUTHORITY_SHA_MISMATCH");
  }
  if (input.activeWal) blocks.push("ACTIVE_WAL");
  if (input.freeDiskBytes < input.minFreeDiskBytes) blocks.push("INSUFFICIENT_DISK");
  if (input.queueDigest !== input.requestQueueDigest) blocks.push("QUEUE_DIGEST_MISMATCH");
  if (input.alreadyProcessedRequestIds.includes(input.requestId)) blocks.push("REQUEST_REPLAY");
  return { ok: blocks.length === 0, blocks };
}

// task status 遷移の妥当性（append-only な履歴として扱う）。
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  READY: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["RUNNING", "BLOCKED", "CANCELLED", "FAILED_RETRYABLE"],
  RUNNING: ["CHECKPOINTED", "PASS", "CONDITIONAL", "BLOCKED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  CHECKPOINTED: ["RUNNING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  PASS: [], CONDITIONAL: ["READY"], BLOCKED: ["READY", "CANCELLED"],
  FAILED_RETRYABLE: ["READY", "FAILED_FINAL", "CANCELLED"], FAILED_FINAL: [], CANCELLED: [],
};
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type FailureClass = "RETRYABLE" | "NON_RETRYABLE";
// 失敗分類。同一 non-retryable 失敗を無限に再試行しない。
export function classifyFailure(code: string): FailureClass {
  const nonRetryable = [
    "L4_FORBIDDEN", "L3_REQUIRES_GRANT", "LEVEL_NOT_ALLOWED", "REQUEST_REPLAY",
    "INVALID_REQUEST", "AUTHORITY_SHA_MISMATCH", "QUEUE_DIGEST_MISMATCH",
    "DIRTY_WORKING_TREE", "PATH_NOT_ALLOWED", "EMERGENCY_STOP_ACTIVE",
  ];
  return nonRetryable.includes(code) ? "NON_RETRYABLE" : "RETRYABLE";
}

// git write path allowlist（allowlist 外の path を触る変更は拒否）。
export function isPathAllowed(path: string, allowlist: string[]): boolean {
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  return allowlist.some((prefix) => path === prefix || path.startsWith(prefix));
}
export function checkChangedPaths(paths: string[], allowlist: string[]): { ok: boolean; rejected: string[] } {
  const rejected = paths.filter((p) => !isPathAllowed(p, allowlist));
  return { ok: rejected.length === 0, rejected };
}
