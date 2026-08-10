// boat-pon 単一 research runner（1 canonical request = 1 task）。
//
// 正本分離:
//   - 定義: automation/task-catalog.json（main, immutable）
//   - 状態: automation/control/task-queue-state.json（automation branch, mutable。workflow が
//     runner の working tree に materialize 済み）
//   - ledger: automation/control/processed-{intents,requests}.json（automation branch）
//
// ループ・daemon・watch・schedule は持たない。実行後は必ず終了する。
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ORCHESTRATOR_VERSION, STATUS_SCHEMA_VERSION, canTransition, classifyFailure, decideSafety,
  foreignDirtyPaths, preflight, validateRequest, type SafetyLevel, type TaskStatus,
} from "../src/automation/researchOrchestrator";
import {
  computeStateDigest, mergeCatalogAndState, reconcileCatalogState, resolveTask, validateCatalog, validateQueueState,
  type QueueState,
} from "../src/automation/taskCatalog";
import {
  assertReplayLedgersConsistent, computeIdempotencyKey, findIdempotentSuccess, isIntentProcessed, isRequestReplay,
  type ProcessedRequestLedger,
} from "../src/automation/dispatchIntent";
import { EXECUTOR_REGISTRY_VERSION, resolveExecutor, type ExecutorResult } from "../src/automation/taskExecutors";
import { buildResearchAutomationFailureHistory } from "../src/automation/researchAutomationFailureHistory";
import { retainExecutorOutputs } from "../src/automation/researchRetainedOutputs";

const root = resolve(process.cwd());
const arg = (n: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`--${n}=`));
  if (d) return d.slice(n.length + 3);
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

const policy = JSON.parse(readFileSync(join(root, "config/research-automation-policy.json"), "utf8"));
const CATALOG_PATH = join(root, "automation/task-catalog.json");
const CONTROL_DIR = join(root, "automation/control");
const STATE_PATH = join(CONTROL_DIR, "task-queue-state.json");
const PROCESSED_REQ = join(CONTROL_DIR, "processed-requests.json");
const PROCESSED_INT = join(CONTROL_DIR, "processed-intents.json");
const CURRENT_RUN = join(CONTROL_DIR, "current-run.json");
const STATUS_JSON = join(root, "reports/automation/current-status.json");
const STATUS_MD = join(root, "reports/automation/current-status.md");
const HISTORY_DIR = join(root, "reports/automation/history");
const LOCK_PATH = join(root, policy.lock.path);
const EMERGENCY = join(root, policy.guards.emergencyStopPath);
const PAUSED = join(root, policy.guards.pausePath);

const git = (...a: string[]): string => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const nowIso = (): string => new Date().toISOString();
const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const writeJsonAtomic = (p: string, obj: unknown): void => {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, p);
};

function writeStatus(patch: Record<string, unknown>): void {
  const prev = readJson(STATUS_JSON) ?? {};
  const status = { statusSchemaVersion: STATUS_SCHEMA_VERSION, orchestratorVersion: ORCHESTRATOR_VERSION, updatedAt: nowIso(), ...prev, ...patch };
  mkdirSync(dirname(STATUS_JSON), { recursive: true });
  writeFileSync(STATUS_JSON, `${JSON.stringify(status, null, 2)}\n`);
  writeFileSync(STATUS_MD, renderStatusMd(status));
}
function renderStatusMd(s: Record<string, any>): string {
  const v = (x: unknown): string => (x === undefined || x === null || x === "" ? "NOT_AVAILABLE" : String(x));
  return `# boat-pon automation status

- updated: ${v(s.updatedAt)}
- last result: **${v(s.lastResult)}**
- last request: ${v(s.lastRequestId)} / task: ${v(s.lastTaskId)} / intent: ${v(s.lastIntentId)}
- safety: ${v(s.lastSafetyLevel)} / authority SHA: ${v(s.authoritySha)}
- state version: ${v(s.stateVersion)} / state digest: ${v(s.stateDigest)}
- blocks: ${Array.isArray(s.blocks) && s.blocks.length ? s.blocks.join(", ") : "none"}
- idempotent reuse: ${v(s.idempotentReuse)}
- next candidate: ${v(s.nextCandidate)}
- note: 1 dispatch = 1 task。schedule/daemon/loop なし。状態正本は automation branch。
`;
}

// ---- lock（atomic single-flight）----
let LOCK_TOKEN: string | null = null;
function acquireLock(owner: Record<string, unknown>): boolean {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  const lockToken = randomUUID();
  const payload = `${JSON.stringify({ ...owner, lockToken, acquiredAt: nowIso(), heartbeatAt: nowIso() }, null, 2)}\n`;
  try {
    // wx = O_CREAT|O_EXCL: a concurrent runner cannot replace an existing lock.
    writeFileSync(LOCK_PATH, payload, { flag: "wx" });
    LOCK_TOKEN = lockToken;
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
function releaseLock(): void {
  const token = LOCK_TOKEN;
  LOCK_TOKEN = null;
  if (!token) return;
  try {
    const current = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    if (current.lockToken === token) rmSync(LOCK_PATH, { force: true });
  } catch {
    // Ownership cannot be proven: keep the lock fail-closed for explicit recovery.
  }
}

let LOCKED = false;
function finish(result: string, exitCode: number, extra: Record<string, unknown> = {}): never {
  writeStatus({ lastResult: result, ...extra });
  writeJsonAtomic(CURRENT_RUN, { runSchemaVersion: "current-run-v1", updatedAt: nowIso(), lastResult: result, ...extra });
  if (LOCKED) releaseLock();
  console.log(JSON.stringify({ result, exitCode, ...extra }, null, 2));
  process.exit(exitCode);
}

// ---- 入力: canonical request ----
const requestPath = arg("request");
if (!requestPath) throw new Error("--request=<canonical-request.json> は必須です");
const raw = JSON.parse(readFileSync(resolve(requestPath), "utf8"));
const validation = validateRequest(raw);
if (!validation.valid || !validation.request) {
  finish("INVALID_REQUEST", 3, { blocks: validation.errors, lastRequestId: raw?.requestId ?? null });
}
const request = validation.request;
const expectedIntentId = request.requestId.replace(/^REQ-/, "INTENT-");
const intentId = arg("intent-id") ?? expectedIntentId;
if (intentId !== expectedIntentId) {
  finish("INVALID_REQUEST", 3, {
    lastRequestId: request.requestId,
    lastIntentId: intentId,
    blocks: ["INTENT_REQUEST_LINEAGE_MISMATCH"],
  });
}
const statusOnly = request.requestedAction === "status-only";
const dryRun = !statusOnly && (request.dryRun === true || request.requestedAction === "dry-run");
const startedMs = Date.now();

// ---- catalog + state をロード ----
const catalogV = validateCatalog(readJson(CATALOG_PATH));
if (!catalogV.valid || !catalogV.catalog) finish("BLOCKED", 3, { blocks: ["CATALOG_INVALID", ...catalogV.errors], lastRequestId: request.requestId });
const catalog = catalogV.catalog;
const stateRaw = readJson(STATE_PATH);
const stateV = validateQueueState(stateRaw);
if (!stateV.valid || !stateV.state) finish("BLOCKED", 3, { blocks: ["STATE_INVALID", ...stateV.errors], lastRequestId: request.requestId });
// reconcile で新規 catalog task を state へ追加できるよう再代入可能にする（既存 entry は保存）。
let state: QueueState = stateV.state;
const stateDigest = computeStateDigest(state);

// ---- lock ----
if (!acquireLock({ owner: "run-intent-task", requestId: request.requestId, taskId: request.taskId, workflowRunId: process.env.GITHUB_RUN_ID ?? null })) {
  finish("LOCK_HELD", 2, { blocks: ["LOCK_HELD"], lastRequestId: request.requestId });
}
LOCKED = true;

try {
  const dataRoot = policy.dataRoot ? resolve(policy.dataRoot) : root;
  const sidecar = join(dataRoot, "data/research-replay.sqlite");
  const walPath = `${sidecar}-wal`;
  const st = statfsSync(root);
  const processedReq: ProcessedRequestLedger | null = readJson(PROCESSED_REQ);
  const processedInt = readJson(PROCESSED_INT);
  const processedIds = processedReq?.requestIds ?? [];

  // Both durable replay ledgers must describe the same completed intent lineage before
  // any READY -> CLAIMED transition. This catches a crash after only one ledger write.
  try {
    assertReplayLedgersConsistent(processedInt, processedReq);
  } catch {
    finish("BLOCKED", 3, {
      lastRequestId: request.requestId,
      lastIntentId: intentId,
      lastTaskId: request.taskId,
      blocks: ["REPLAY_LEDGER_CROSS_CHECK_FAILED"],
      elapsedMs: Date.now() - startedMs,
      nextCandidate: "repair replay ledger lineage; automation は自動再試行しない",
    });
  }

  // A missing, malformed, or replayed processed-intent ledger must block before any
  // READY -> CLAIMED transition so governance corruption never consumes an attempt.
  if (!processedInt || isIntentProcessed(processedInt, intentId)) {
    finish("BLOCKED", 3, {
      lastRequestId: request.requestId,
      lastIntentId: intentId,
      lastTaskId: request.taskId,
      blocks: [!processedInt ? "PROCESSED_INTENT_LEDGER_MISSING" : "PROCESSED_INTENT_LEDGER_INVALID_OR_REPLAY"],
      elapsedMs: Date.now() - startedMs,
      nextCandidate: "repair the processed-intent ledger; automation は自動再試行しない",
    });
  }

  // ---- preflight guards ----
  const pre = preflight({
    emergencyStop: existsSync(EMERGENCY),
    paused: existsSync(PAUSED),
    workingTreeClean: foreignDirtyPaths(
      git("status", "--porcelain").split("\n").map((l) => l.replace(/^\s*\S{1,2}\s+/, "").trim()).filter(Boolean),
    ).length === 0,
    localHeadSha: git("rev-parse", "HEAD"),
    parentShas: (() => { try { return [git("rev-parse", "HEAD^")]; } catch { return []; } })(),
    originHeadSha: (() => { try { git("fetch", "origin", "--quiet"); return git("rev-parse", "origin/main"); } catch { return git("rev-parse", "HEAD"); } })(),
    activeWal: existsSync(walPath) && statSync(walPath).size > 0,
    freeDiskBytes: Number(st.bavail) * Number(st.bsize),
    minFreeDiskBytes: policy.guards.minFreeDiskBytes,
    queueDigest: stateDigest,
    requestQueueDigest: request.queueDigest,
    authoritySha: request.authoritySha,
    alreadyProcessedRequestIds: processedIds,
    requestId: request.requestId,
  });
  const safety = decideSafety(request.safetyLevel as SafetyLevel, policy, { present: false, valid: false });
  const blocks = [...pre.blocks, ...(safety.allowed ? [] : [safety.code])];
  if (blocks.length > 0) {
    finish(safety.code === "L4_FORBIDDEN" ? "REJECTED_L4" : "BLOCKED", 3, {
      lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: request.taskId, lastSafetyLevel: request.safetyLevel,
      authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest, blocks,
      failureClasses: blocks.map(classifyFailure), elapsedMs: Date.now() - startedMs,
      nextCandidate: "resolve the blocks above; automation は自動再試行しない",
    });
  }

  // ---- task 解決（catalog+state merge, dependency gate）----
  const merged = mergeCatalogAndState(catalog, state);
  const resolved = resolveTask(merged, request.taskId);
  if (!resolved.task) finish("TASK_NOT_FOUND", 3, { lastRequestId: request.requestId, lastTaskId: request.taskId, blocks: ["TASK_NOT_FOUND"], elapsedMs: Date.now() - startedMs });
  const task = resolved.task;

  // status-only はqueue/attempt/executorを一切変更せず、現在状態だけを返す。
  // READY / dependency / stale-definition gate は実行可否のためのものなのでread-only照会には適用しない。
  if (statusOnly) {
    finish("DRY_RUN_OK", 0, {
      lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, lastSafetyLevel: request.safetyLevel,
      authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest, blocks: [],
      taskStatus: task.status, staleDefinition: task.staleDefinition, elapsedMs: Date.now() - startedMs,
      nextCandidate: pickNext(merged),
    });
  }

  if (task.staleDefinition) finish("BLOCKED", 3, { lastRequestId: request.requestId, lastTaskId: task.taskId, blocks: ["STALE_TASK_DEFINITION"], elapsedMs: Date.now() - startedMs, nextCandidate: "rebase/revalidation 待ち" });
  if (task.status !== "READY") finish("TASK_NOT_READY", 3, { lastRequestId: request.requestId, lastTaskId: task.taskId, blocks: [`TASK_STATUS_${task.status}`], elapsedMs: Date.now() - startedMs });
  const depsOk = (task.dependencies ?? []).every((d) => merged.find((x) => x.taskId === d)?.status === "PASS");
  if (!depsOk) finish("BLOCKED", 3, { lastRequestId: request.requestId, lastTaskId: task.taskId, blocks: ["DEPENDENCY_NOT_SATISFIED"], elapsedMs: Date.now() - startedMs });

  // ---- idempotency: 同 key の成功があれば再実行しない ----
  const idempotencyKey = computeIdempotencyKey({
    taskId: task.taskId, taskDefinitionVersion: task.taskDefinitionVersion, authoritySha: request.authoritySha,
    stateVersion: state.stateVersion, executorVersion: EXECUTOR_REGISTRY_VERSION,
    inputIdentity: policy.dataRoot ? "sidecar:corrected-truth-v1" : "sidecar", safetyLevel: request.safetyLevel,
  });
  const reuse = findIdempotentSuccess(processedReq, idempotencyKey);
  if (reuse && !dryRun) {
    appendLedgers(intentId, request.requestId, reuse.result, idempotencyKey, reuse.evidencePath);
    finish(reuse.result, 0, {
      lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, lastSafetyLevel: request.safetyLevel,
      authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest, idempotentReuse: true,
      evidencePath: reuse.evidencePath, blocks: [], elapsedMs: Date.now() - startedMs, nextCandidate: pickNext(merged),
    });
  }

  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  mkdirSync(HISTORY_DIR, { recursive: true });

  // ---- dry-run: 実行せず承認可否だけ返す ----
  if (dryRun) {
    finish("DRY_RUN_OK", 0, {
      lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, lastSafetyLevel: request.safetyLevel,
      authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest, blocks: [],
      elapsedMs: Date.now() - startedMs, nextCandidate: pickNext(merged),
    });
  }

  // ---- catalog-state reconciliation（task 実行前・非 dry-run のみ書き込み）----
  // catalog(main) に在り state(branch) に無い task（例: 追加直後の TASK-N2-010）へ state entry を
  // 追加する。既存 entry・PASS・証拠は保存。updateState が "state entry not found" で失敗するのを防ぐ。
  // dry-run はここへ到達しない（上で短絡）ため state write は起きない（#dry-run no write）。
  {
    const rec = reconcileCatalogState(catalog, state, {});
    if (rec.changed) {
      state = rec.nextState;
      writeJsonAtomic(STATE_PATH, state);
      const migDir = join(root, "reports/automation/migrations");
      mkdirSync(migDir, { recursive: true });
      writeJsonAtomic(join(migDir, `reconcile-${runId}.json`), {
        reconciliationVersion: "catalog-state-reconcile-v1", runId, requestId: request.requestId,
        toCatalogVersion: catalog.catalogVersion, toStateVersion: state.stateVersion,
        added: rec.plan.added, staleDefinition: rec.plan.staleDefinition, orphaned: rec.plan.orphaned, at: nowIso(),
      });
    }
  }

  // ---- executor 解決 ----
  const { executor, code } = resolveExecutor(task.taskType);
  if (!executor) {
  const completedAt = nowIso();
  const evidencePath = `reports/automation/history/${runId}-${task.taskId}.json`;
  const evidence = buildResearchAutomationFailureHistory({
    runId, requestId: request.requestId, intentId, taskId: task.taskId, taskType: task.taskType,
    safetyLevel: request.safetyLevel as "L0" | "L1" | "L2" | "L3",
    executorVersion: EXECUTOR_REGISTRY_VERSION, result: "BLOCKED", failureCode: code,
    finalTaskStatus: task.status, message: `no executor registered for ${task.taskType}; task stays READY`,
    authoritySha: git("rev-parse", request.authoritySha), idempotencyKey,
    startedAt: new Date(startedMs).toISOString(), completedAt, elapsedMs: Date.now() - startedMs,
  });
  writeJsonAtomic(join(HISTORY_DIR, `${runId}-${task.taskId}.json`), evidence);
  appendLedgers(intentId, request.requestId, "BLOCKED", idempotencyKey, evidencePath);
  finish("BLOCKED", 3, { lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest, blocks: [code], elapsedMs: Date.now() - startedMs, evidencePath, nextCandidate: pickNext(mergeCatalogAndState(catalog, state)) });
}

  // ---- state: READY → CLAIMED → RUNNING ----
  updateState(task.taskId, { status: "CLAIMED", attemptCount: (state.tasks[task.taskId]?.attemptCount ?? 0) + 1, authoritySha: request.authoritySha });
  updateState(task.taskId, { status: "RUNNING" });

  const taskStatuses = Object.fromEntries(merged.map((t) => [t.taskId, t.status]));
  let exec: ExecutorResult;
  try {
    exec = executor({
      repoRoot: root, runId, requestId: request.requestId, taskId: task.taskId,
      sidecarPath: sidecar, historyDir: HISTORY_DIR, reportsDir: join(root, "reports/n2"),
      dryRun: false, taskStatuses,
      mergedTasks: merged.map((t) => ({ taskId: t.taskId, status: t.status, taskType: t.taskType, defaultStatus: t.defaultStatus, dependencies: t.dependencies, title: t.title, objective: t.objective, safetyLevel: t.safetyLevel })),
      controlDir: CONTROL_DIR,
    });
  } catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  const attempts = (state.tasks[task.taskId]?.attemptCount ?? 1);
  const finalStatus = attempts >= (state.tasks[task.taskId]?.maxAttempts ?? 3) ? "FAILED_FINAL" : "FAILED_RETRYABLE";
  updateState(task.taskId, { status: finalStatus, lastFailure: { code: "EXECUTOR_EXCEPTION", message: message.slice(0, 300), at: nowIso() } });
  const completedAt = nowIso();
  const evidencePath = `reports/automation/history/${runId}-${task.taskId}.json`;
  const evidence = buildResearchAutomationFailureHistory({
    runId, requestId: request.requestId, intentId, taskId: task.taskId, taskType: task.taskType,
    safetyLevel: request.safetyLevel as "L0" | "L1" | "L2" | "L3",
    executorVersion: EXECUTOR_REGISTRY_VERSION, result: "FAILED", failureCode: "EXECUTOR_EXCEPTION",
    finalTaskStatus: finalStatus, message,
    authoritySha: git("rev-parse", request.authoritySha), idempotencyKey,
    startedAt: new Date(startedMs).toISOString(), completedAt, elapsedMs: Date.now() - startedMs,
  });
  writeJsonAtomic(join(HISTORY_DIR, `${runId}-${task.taskId}.json`), evidence);
  appendLedgers(intentId, request.requestId, finalStatus, idempotencyKey, evidencePath);
  finish(finalStatus, 1, { lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest: computeStateDigest(state), blocks: ["EXECUTOR_EXCEPTION"], elapsedMs: Date.now() - startedMs, evidencePath, nextCandidate: pickNext(mergeCatalogAndState(catalog, state)) });
}

  // ---- 結果を state へ反映 ----
  // 防御: runner は dry-run で executor を呼ばない（上で DRY_RUN_OK に短絡）ため、executor から
  // DRY_RUN_OK が返ることは正常系では起きない。万一返ったら PASS 遷移させず BLOCK する（fail-closed）。
  if ((exec.result as string) === "DRY_RUN_OK") {
  updateState(task.taskId, { status: "BLOCKED", lastFailure: { code: "UNEXPECTED_DRY_RUN_RESULT", at: nowIso() } });
  const completedAt = nowIso();
  const evidencePath = `reports/automation/history/${runId}-${task.taskId}.json`;
  const evidence = buildResearchAutomationFailureHistory({
    runId, requestId: request.requestId, intentId, taskId: task.taskId, taskType: task.taskType,
    safetyLevel: request.safetyLevel as "L0" | "L1" | "L2" | "L3",
    executorVersion: exec.executorVersion, result: "BLOCKED", failureCode: "UNEXPECTED_DRY_RUN_RESULT",
    finalTaskStatus: "BLOCKED", message: "executor returned DRY_RUN_OK during non-dry-run execution",
    authoritySha: git("rev-parse", request.authoritySha), idempotencyKey,
    startedAt: new Date(startedMs).toISOString(), completedAt, elapsedMs: Date.now() - startedMs,
  });
  writeJsonAtomic(join(HISTORY_DIR, `${runId}-${task.taskId}.json`), evidence);
  appendLedgers(intentId, request.requestId, "BLOCKED", idempotencyKey, evidencePath);
  finish("BLOCKED", 3, { lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest: computeStateDigest(state), blocks: ["UNEXPECTED_DRY_RUN_RESULT"], elapsedMs: Date.now() - startedMs, evidencePath, nextCandidate: pickNext(mergeCatalogAndState(catalog, state)) });
}
  let historyOutputs: string[];
  try {
    historyOutputs = retainExecutorOutputs({ repoRoot: root, runId, outputPaths: exec.outputs, historyOutputDigest: exec.outputDigest }).historyOutputs;
  } catch (error) {
    const retentionBlock = "DURABLE_OUTPUT_RETENTION_FAILED";
    const retentionMessage = error instanceof Error ? error.message : String(error);
    const completedAt = nowIso();
    const retentionEvidencePath = `reports/automation/history/${runId}-${task.taskId}.json`;
    updateState(task.taskId, {
      status: "BLOCKED",
      evidenceLinks: [...new Set([...(state.tasks[task.taskId]?.evidenceLinks ?? []), retentionEvidencePath, ...exec.outputs])],
      resultDigest: exec.outputDigest,
      lastFailure: { code: retentionBlock, message: retentionMessage.slice(0, 300), at: completedAt },
      nextDecision: `blocks: ${retentionBlock}`,
    });
    const evidence = buildResearchAutomationFailureHistory({
      runId, requestId: request.requestId, intentId, taskId: task.taskId, taskType: task.taskType,
      safetyLevel: request.safetyLevel as "L0" | "L1" | "L2" | "L3",
      executorVersion: exec.executorVersion, result: "BLOCKED", failureCode: retentionBlock,
      finalTaskStatus: "BLOCKED", message: retentionMessage,
      authoritySha: git("rev-parse", request.authoritySha), idempotencyKey,
      startedAt: new Date(startedMs).toISOString(), completedAt, elapsedMs: Date.now() - startedMs,
    });
    writeJsonAtomic(join(HISTORY_DIR, `${runId}-${task.taskId}.json`), evidence);
    appendLedgers(intentId, request.requestId, "BLOCKED", idempotencyKey, retentionEvidencePath);
    finish("BLOCKED", 3, {
      lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId,
      authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest: computeStateDigest(state),
      blocks: [retentionBlock], elapsedMs: Date.now() - startedMs, evidencePath: retentionEvidencePath,
      outputs: exec.outputs, outputDigest: exec.outputDigest, taskStatus: "BLOCKED",
      nextCandidate: pickNext(mergeCatalogAndState(catalog, state)),
    });
  }

  const attempts = state.tasks[task.taskId]?.attemptCount ?? 1;
  const maxAttempts = state.tasks[task.taskId]?.maxAttempts ?? 3;
  const nextStatus: TaskStatus = exec.result === "PASS" ? "PASS" : exec.result === "CONDITIONAL" ? "CONDITIONAL" : exec.result === "BLOCKED" ? "BLOCKED" : attempts >= maxAttempts ? "FAILED_FINAL" : "FAILED_RETRYABLE";
  const evidencePath = `reports/automation/history/${runId}-${task.taskId}.json`;
  updateState(task.taskId, {
    status: nextStatus,
    evidenceLinks: [...new Set([...(state.tasks[task.taskId]?.evidenceLinks ?? []), evidencePath, ...exec.outputs, ...historyOutputs])],
    resultDigest: exec.outputDigest,
    lastFailure: exec.blocks.length ? { code: exec.blocks[0], at: nowIso() } : null,
    nextDecision: exec.result === "PASS" ? "依存 task を次回 dispatch 候補にする（自動起動しない）" : `blocks: ${exec.blocks.join(",") || "none"}`,
  });
  // recurring task（planner 等）は成功後に READY へ戻し、成功済みcycleのattempt budgetを持ち越さない。
  // 次回も明示dispatch可能だが、自動起動はしない。
  if (task.recurring && (nextStatus === "PASS" || nextStatus === "CONDITIONAL")) {
    updateState(task.taskId, { status: "READY", attemptCount: 0 }, true);
  }
  writeJsonAtomic(join(HISTORY_DIR, `${runId}-${task.taskId}.json`), {
    runId, requestId: request.requestId, intentId, taskId: task.taskId, taskType: task.taskType, safetyLevel: request.safetyLevel,
    executorVersion: exec.executorVersion, executed: true, result: exec.result, blocks: exec.blocks, outputs: historyOutputs,
    outputDigest: exec.outputDigest, summary: exec.summary, authoritySha: git("rev-parse", request.authoritySha), idempotencyKey,
    startedAt: new Date(startedMs).toISOString(), completedAt: nowIso(), elapsedMs: Date.now() - startedMs,
  });
  appendLedgers(intentId, request.requestId, exec.result, idempotencyKey, evidencePath);

  const finalTaskStatus = state.tasks[task.taskId]?.status ?? nextStatus;
  finish(exec.result, exec.result === "PASS" || exec.result === "CONDITIONAL" ? 0 : exec.result === "BLOCKED" ? 3 : 1, {
    lastRequestId: request.requestId, lastIntentId: intentId, lastTaskId: task.taskId, lastSafetyLevel: request.safetyLevel,
    authoritySha: request.authoritySha, stateVersion: state.stateVersion, stateDigest: computeStateDigest(state),
    blocks: exec.blocks, elapsedMs: Date.now() - startedMs, evidencePath, outputs: historyOutputs, outputDigest: exec.outputDigest,
    taskStatus: finalTaskStatus, nextCandidate: pickNext(mergeCatalogAndState(catalog, state)),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  finish("FAILED", 1, { blocks: [message.slice(0, 200)], failureClasses: [classifyFailure("RUNTIME_ERROR")], elapsedMs: Date.now() - startedMs });
} finally {
  if (LOCKED) releaseLock();
}

// ---- helpers ----
function pickNext(merged: ReturnType<typeof mergeCatalogAndState>): string {
  const byId = new Map(merged.map((t) => [t.taskId, t]));
  const next = merged.find((t) => t.status === "READY" && !t.staleDefinition && (t.dependencies ?? []).every((d) => byId.get(d)?.status === "PASS"));
  return next ? `${next.taskId}: ${next.title}（自動起動しない。次回 dispatch で 1 回だけ依頼する）` : "no dispatchable READY task（TASK-PLANNER-NEXT で補充可）";
}

// state を atomic 更新（canTransition 検証 + stateVersion++ + CAS 用 digest）。
// force=true は recurring task の PASS→READY リセット専用（通常遷移では使わない）。
function updateState(taskId: string, patch: Record<string, unknown>, force = false): void {
  const cur = state.tasks[taskId];
  if (!cur) throw new Error(`state entry not found: ${taskId}`);
  if (!force && typeof patch.status === "string" && patch.status !== cur.status) {
    if (!canTransition(cur.status, patch.status as TaskStatus)) throw new Error(`illegal transition ${cur.status} -> ${patch.status}`);
  }
  Object.assign(cur, patch, { updatedAt: nowIso() });
  state.stateVersion += 1;
  state.updatedAt = nowIso();
  writeJsonAtomic(STATE_PATH, state);
}

// processed ledger（automation branch 正本）へ append。intent / request / idempotency を記録。
function appendLedgers(intentId: string, requestId: string, result: string, idempotencyKey: string, evidencePath?: string): void {
  const intents = readJson(PROCESSED_INT);
  const reqs: ProcessedRequestLedger | null = readJson(PROCESSED_REQ);
  if (!intents) throw new Error("missing processed intent ledger during append");
  if (!reqs) throw new Error("missing processed request ledger during append");
  assertReplayLedgersConsistent(intents, reqs);
  if (isIntentProcessed(intents, intentId)) throw new Error("processed intent ledger is malformed or intent is already recorded");
  if (isRequestReplay(reqs, requestId)) throw new Error("processed request ledger is malformed or request is already recorded");
  // Full idempotency-map validation must happen before either ledger is mutated.
  findIdempotentSuccess(reqs, idempotencyKey);

  intents.intentIds.push(intentId);
  intents.entries.push({ intentId, requestId, result, recordedAt: nowIso() });
  intents.updatedAt = nowIso();

  reqs.requestIds.push(requestId);
  // idempotency: first writer is canonical; reuse must not rewrite the successful provenance record.
  if (!(idempotencyKey in reqs.idempotencyKeys)) {
    reqs.idempotencyKeys[idempotencyKey] = { requestId, result, evidencePath, recordedAt: nowIso() };
  }
  reqs.updatedAt = nowIso();

  // Persist request replay authority first. If the process stops between writes, the
  // request remains durably replay-blocked while the one-way intent -> request invariant stays valid.
  writeJsonAtomic(PROCESSED_REQ, reqs);
  writeJsonAtomic(PROCESSED_INT, intents);
}
