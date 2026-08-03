// boat-pon one-shot research task runner（1 request = 1 task）。
// ループ・daemon・watch・schedule は持たない（禁止）。実行後は必ず終了する。
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ORCHESTRATOR_VERSION, STATUS_SCHEMA_VERSION, classifyFailure, decideSafety, preflight, validateRequest,
  type SafetyLevel, type TaskRequest,
} from "../src/automation/researchOrchestrator";

const root = resolve(process.cwd());
const arg = (n: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`--${n}=`));
  if (d) return d.slice(n.length + 3);
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);
const mode = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "task";

const policy = JSON.parse(readFileSync(join(root, "config/research-automation-policy.json"), "utf8"));
const LOCK_PATH = join(root, policy.lock.path);
const STATUS_JSON = join(root, "reports/automation/current-status.json");
const STATUS_MD = join(root, "reports/automation/current-status.md");
const HISTORY_DIR = join(root, "reports/automation/history");
const EMERGENCY = join(root, policy.guards.emergencyStopPath);
const PAUSED = join(root, policy.guards.pausePath);

const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const nowIso = (): string => new Date().toISOString();

function writeStatus(patch: Record<string, unknown>): void {
  const prev = existsSync(STATUS_JSON) ? JSON.parse(readFileSync(STATUS_JSON, "utf8")) : {};
  const status = {
    statusSchemaVersion: STATUS_SCHEMA_VERSION, orchestratorVersion: ORCHESTRATOR_VERSION,
    updatedAt: nowIso(), ...prev, ...patch,
  };
  mkdirSync(dirname(STATUS_JSON), { recursive: true });
  writeFileSync(STATUS_JSON, `${JSON.stringify(status, null, 2)}\n`);
  writeFileSync(STATUS_MD, renderStatusMd(status));
}
function renderStatusMd(s: Record<string, any>): string {
  const v = (x: unknown): string => (x === undefined || x === null || x === "" ? "NOT_AVAILABLE" : String(x));
  return `# boat-pon automation status

- updated: ${v(s.updatedAt)}
- orchestrator: ${v(s.orchestratorVersion)}
- last result: **${v(s.lastResult)}**
- last request: ${v(s.lastRequestId)} / task: ${v(s.lastTaskId)}
- last action: ${v(s.lastAction)} / safety: ${v(s.lastSafetyLevel)}
- authority SHA: ${v(s.authoritySha)}
- emergency stop: ${v(s.emergencyStop)} / paused: ${v(s.paused)}
- lock: ${v(s.lockState)}
- blocks: ${Array.isArray(s.blocks) && s.blocks.length ? s.blocks.join(", ") : "none"}
- elapsed: ${v(s.elapsedMs)} ms
- next candidate: ${v(s.nextCandidate)}
- note: automation は 1 dispatch = 1 task。schedule/daemon/loop なし。
`;
}

// ---- lock（PID だけに依存しない atomic single-flight）----
function acquireLock(owner: Record<string, unknown>): boolean {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  if (existsSync(LOCK_PATH)) {
    try {
      const cur = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
      const age = (Date.now() - Date.parse(cur.heartbeatAt ?? cur.acquiredAt)) / 1000;
      if (age < policy.lock.staleAfterSeconds) return false;
      // stale lock: 明示的に記録して奪取する。
      writeFileSync(`${LOCK_PATH}.stale-${Date.now()}.json`, JSON.stringify(cur, null, 2));
    } catch { /* malformed lock は stale 扱い */ }
    rmSync(LOCK_PATH, { force: true });
  }
  const tmp = `${LOCK_PATH}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...owner, acquiredAt: nowIso(), heartbeatAt: nowIso() }, null, 2)}\n`);
  try { renameSync(tmp, LOCK_PATH); return true; } catch { rmSync(tmp, { force: true }); return false; }
}
const releaseLock = (): void => { rmSync(LOCK_PATH, { force: true }); };

function finish(result: string, exitCode: number, extra: Record<string, unknown> = {}): never {
  writeStatus({ lastResult: result, ...extra });
  releaseLock();
  console.log(JSON.stringify({ result, exitCode, ...extra }, null, 2));
  process.exit(exitCode);
}

// ---- sub-commands（すべて一回で終了）----
if (mode === "status") {
  const s = existsSync(STATUS_JSON) ? JSON.parse(readFileSync(STATUS_JSON, "utf8")) : { lastResult: "NOT_STARTED" };
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
if (mode === "pause") { mkdirSync(dirname(PAUSED), { recursive: true }); writeFileSync(PAUSED, `paused at ${nowIso()}\n`); console.log("PAUSED"); process.exit(0); }
if (mode === "resume") { rmSync(PAUSED, { force: true }); console.log("RESUMED"); process.exit(0); }
if (mode === "emergency-stop") { mkdirSync(dirname(EMERGENCY), { recursive: true }); writeFileSync(EMERGENCY, `emergency stop at ${nowIso()}\n`); console.log("EMERGENCY_STOP_SET"); process.exit(0); }
if (mode === "clear-emergency-stop") { rmSync(EMERGENCY, { force: true }); console.log("EMERGENCY_STOP_CLEARED"); process.exit(0); }

// ---- validate-request / task ----
const requestPath = arg("request");
if (!requestPath) throw new Error("--request=<request.json> は必須です");
const raw = JSON.parse(readFileSync(resolve(requestPath), "utf8"));
const validation = validateRequest(raw);

if (mode === "validate-request") {
  console.log(JSON.stringify({ valid: validation.valid, errors: validation.errors }, null, 2));
  process.exit(validation.valid ? 0 : 3);
}
if (!validation.valid || !validation.request) {
  writeStatus({ lastResult: "INVALID_REQUEST", blocks: validation.errors, lastRequestId: raw?.requestId ?? null });
  console.log(JSON.stringify({ result: "INVALID_REQUEST", exitCode: 3, errors: validation.errors }, null, 2));
  process.exit(3);
}
const request: TaskRequest = validation.request;
const dryRun = hasFlag("dry-run") || request.dryRun === true || request.requestedAction === "dry-run";
const startedMs = Date.now();

// ---- lock ----
if (!acquireLock({ owner: "run-research-task", requestId: request.requestId, taskId: request.taskId, workflowRunId: process.env.GITHUB_RUN_ID ?? null, authoritySha: request.authoritySha })) {
  writeStatus({ lastResult: "LOCK_HELD", lastRequestId: request.requestId, blocks: ["LOCK_HELD"] });
  console.log(JSON.stringify({ result: "LOCK_HELD", exitCode: 2 }, null, 2));
  process.exit(2);
}

try {
  // ---- preflight guards ----
  const queue = JSON.parse(readFileSync(join(root, "automation/task-queue.json"), "utf8"));
  const queueDigest = createHash("sha256").update(JSON.stringify(queue)).digest("hex");
  const sidecar = join(root, "data/research-replay.sqlite");
  const walPath = `${sidecar}-wal`;
  const st = statfsSync(root);
  const processedIds = existsSync(join(root, "automation/requests/completed"))
    ? execFileSync("ls", [join(root, "automation/requests/completed")], { encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.replace(/\.json$/, ""))
    : [];

  const pre = preflight({
    emergencyStop: existsSync(EMERGENCY),
    paused: existsSync(PAUSED),
    workingTreeClean: git("status", "--porcelain") === "",
    localHeadSha: git("rev-parse", "HEAD"),
    originHeadSha: (() => { try { git("fetch", "origin", "--quiet"); return git("rev-parse", "origin/main"); } catch { return git("rev-parse", "HEAD"); } })(),
    activeWal: existsSync(walPath) && statSync(walPath).size > 0,
    freeDiskBytes: Number(st.bavail) * Number(st.bsize),
    minFreeDiskBytes: policy.guards.minFreeDiskBytes,
    queueDigest, requestQueueDigest: request.queueDigest,
    authoritySha: request.authoritySha,
    alreadyProcessedRequestIds: processedIds,
    requestId: request.requestId,
  });

  const safety = decideSafety(request.safetyLevel as SafetyLevel, policy, { present: false, valid: false });
  const blocks = [...pre.blocks, ...(safety.allowed ? [] : [safety.code])];

  if (blocks.length > 0) {
    const cls = blocks.map(classifyFailure);
    finish(safety.code === "L4_FORBIDDEN" ? "REJECTED_L4" : "BLOCKED", 3, {
      lastRequestId: request.requestId, lastTaskId: request.taskId, lastAction: request.requestedAction,
      lastSafetyLevel: request.safetyLevel, authoritySha: request.authoritySha, blocks,
      failureClasses: cls, elapsedMs: Date.now() - startedMs,
      nextCandidate: "resolve the blocks above; automation は自動再試行しない",
    });
  }

  if (dryRun || request.requestedAction === "status-only") {
    finish("DRY_RUN_OK", 0, {
      lastRequestId: request.requestId, lastTaskId: request.taskId, lastAction: request.requestedAction,
      lastSafetyLevel: request.safetyLevel, authoritySha: request.authoritySha, blocks: [],
      elapsedMs: Date.now() - startedMs, nextCandidate: pickNext(queue),
    });
  }

  // ---- claim exactly one task ----
  const task = request.taskId === "NEXT"
    ? queue.tasks.find((t: any) => t.status === "READY")
    : queue.tasks.find((t: any) => t.taskId === request.taskId);
  if (!task) {
    finish("TASK_NOT_FOUND", 3, { lastRequestId: request.requestId, lastTaskId: request.taskId, blocks: ["TASK_NOT_FOUND"], elapsedMs: Date.now() - startedMs });
  }
  if (task.status !== "READY") {
    finish("TASK_NOT_READY", 3, { lastRequestId: request.requestId, lastTaskId: task.taskId, blocks: [`TASK_STATUS_${task.status}`], elapsedMs: Date.now() - startedMs });
  }

  // 実タスク実行は allowlist された command のみ（arbitrary shell 禁止）。
  // 現時点では L0/L1/L2 の read-only 集計・canary を将来接続する枠のみを用意し、
  // 未接続 task は NO_CHANGE として明示的に終了する（失敗を PASS 扱いしない）。
  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  mkdirSync(HISTORY_DIR, { recursive: true });
  const evidence = {
    runId, requestId: request.requestId, taskId: task.taskId, taskType: task.taskType,
    safetyLevel: request.safetyLevel, startedAt: new Date(startedMs).toISOString(), completedAt: nowIso(),
    executed: false,
    result: "NO_CHANGE",
    reason: "task executor is not wired for this taskType yet; orchestrator intentionally performs no work rather than reporting false success",
    authoritySha: request.authoritySha,
  };
  writeFileSync(join(HISTORY_DIR, `${runId}-${task.taskId}.json`), `${JSON.stringify(evidence, null, 2)}\n`);

  finish("NO_CHANGE", 0, {
    lastRequestId: request.requestId, lastTaskId: task.taskId, lastAction: request.requestedAction,
    lastSafetyLevel: request.safetyLevel, authoritySha: request.authoritySha, blocks: [],
    elapsedMs: Date.now() - startedMs, evidencePath: `reports/automation/history/${runId}-${task.taskId}.json`,
    nextCandidate: pickNext(queue),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  finish("FAILED", 1, { blocks: [message.slice(0, 200)], failureClasses: [classifyFailure("RUNTIME_ERROR")], elapsedMs: Date.now() - startedMs });
} finally {
  releaseLock();
}

function pickNext(queue: any): string {
  const next = queue.tasks.find((t: any) => t.status === "READY");
  return next ? `${next.taskId}: ${next.title}（自動起動しない。次回 dispatch で 1 回だけ依頼する）` : "no READY task";
}
