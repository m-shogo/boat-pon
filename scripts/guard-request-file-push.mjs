// request-file push の guard（runner へ渡す前に ubuntu 上で実行）。
// 追加された request file が「ちょうど 1 件・pending 配下・.json・安全な path・
// strict schema・digest 一致・未処理」であることを検証する。1 つでも外れたら BLOCK。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PENDING_DIR = "automation/requests/pending";
const MAX_BYTES = 65536;
const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };

const before = (process.env.BEFORE_SHA ?? "").trim();
const after = (process.env.AFTER_SHA ?? "").trim();
if (!/^[0-9a-f]{40}$/.test(after)) fail("invalid AFTER_SHA");

// push の diff（before が無い/浅い場合は直前 commit との差分）。
let diff;
try {
  const base = /^[0-9a-f]{40}$/.test(before) && before !== "0".repeat(40) ? before : `${after}^`;
  diff = execFileSync("git", ["diff", "--name-status", base, after], { encoding: "utf8" });
} catch {
  fail("cannot compute push diff");
}

const lines = diff.split("\n").map((l) => l.trim()).filter(Boolean);
const pendingChanges = lines
  .map((l) => { const [status, ...rest] = l.split(/\s+/); return { status, path: rest[rest.length - 1] }; })
  .filter((c) => c.path.startsWith(`${PENDING_DIR}/`));

if (pendingChanges.length === 0) fail("no request file change in this push");
// 変更・削除された request は拒否（request は immutable）。
for (const c of pendingChanges) {
  if (c.status !== "A") fail(`request files are immutable; refused status=${c.status} path=${c.path}`);
}
if (pendingChanges.length !== 1) fail(`exactly one new request per push is allowed (got ${pendingChanges.length})`);

const path = pendingChanges[0].path;
// path 安全性: traversal / 絶対 path / symlink / 非 .json / .gitkeep を拒否。
if (path.includes("..") || path.startsWith("/")) fail(`unsafe path: ${path}`);
if (!/^automation\/requests\/pending\/REQ-[0-9A-Za-z._-]{4,64}\.json$/.test(path)) fail(`path must be ${PENDING_DIR}/REQ-<id>.json (got ${path})`);
if (!existsSync(path)) fail(`request file missing: ${path}`);
if (lstatSync(path).isSymbolicLink()) fail("symlink request file is not allowed");
if (statSync(path).size > MAX_BYTES) fail(`request file too large: ${statSync(path).size} bytes`);

let request;
try { request = JSON.parse(readFileSync(path, "utf8")); } catch { fail("request file is not valid JSON"); }

// strict schema（orchestrator と同一契約を再実装せず、必須 field / 値域だけ guard 側でも確認）。
const REQUIRED = ["requestSchemaVersion", "requestId", "taskId", "requestedAction", "safetyLevel",
  "authoritySha", "queueDigest", "createdAt", "requestedBy", "maxDurationSeconds",
  "expectedOutput", "approvalRequirement", "requestDigest"];
const ALLOWED = new Set([...REQUIRED, "approvalGrantId", "requestReference", "dryRun"]);
for (const k of REQUIRED) if (!(k in request)) fail(`missing field: ${k}`);
for (const k of Object.keys(request)) if (!ALLOWED.has(k)) fail(`unknown field: ${k}`);
if (request.requestSchemaVersion !== "research-task-request-v1") fail("unsupported requestSchemaVersion");

// filename と requestId の一致。
const expectedName = `${PENDING_DIR}/${request.requestId}.json`;
if (path !== expectedName) fail(`filename must match requestId (expected ${expectedName})`);

// safety level: L0/L1/L2 のみ自動許可。L3 は grant 必須、L4 は常時拒否。
if (request.safetyLevel === "L4") fail("L4 is never automated");
if (request.safetyLevel === "L3" && request.approvalRequirement !== "existing-grant-required") {
  fail("L3 requires approvalRequirement=existing-grant-required");
}
if (!["L0", "L1", "L2", "L3"].includes(request.safetyLevel)) fail("invalid safetyLevel");

// request digest 検証（requestDigest 自身を除いた canonical JSON の SHA-256）。
const { requestDigest, ...rest } = request;
const expectedDigest = createHash("sha256").update(JSON.stringify(rest, Object.keys(rest).sort())).digest("hex");
if (expectedDigest !== requestDigest) fail(`requestDigest mismatch (expected ${expectedDigest})`);

// queue digest 検証（commit 時点の queue と一致すること）。
const queue = JSON.parse(readFileSync("automation/task-queue.json", "utf8"));
const queueDigest = createHash("sha256").update(JSON.stringify(queue)).digest("hex");
if (queueDigest !== request.queueDigest) fail(`queueDigest mismatch (expected ${queueDigest})`);

// authority SHA 検証: main の現在 SHA と前方一致すること（古い authority では実行しない）。
if (!after.startsWith(request.authoritySha) && !request.authoritySha.startsWith(after)) {
  fail(`stale authoritySha: request=${request.authoritySha} main=${after.slice(0, 12)}`);
}

// replay 防止: processed registry（completed/failed）に同じ requestId があれば拒否。
for (const dir of ["automation/requests/completed", "automation/requests/failed"]) {
  if (existsSync(dir) && readdirSync(dir).some((f) => f === `${request.requestId}.json`)) {
    fail(`duplicate/replayed requestId: ${request.requestId}`);
  }
}

// task 存在と状態の確認（RUNNING/CLAIMED の重複依頼を防ぐ）。
if (request.taskId !== "NEXT") {
  const task = queue.tasks.find((t) => t.taskId === request.taskId);
  if (!task) fail(`task not found in queue: ${request.taskId}`);
  if (["CLAIMED", "RUNNING"].includes(task.status)) fail(`task already in progress: ${task.status}`);
}

console.log(`ok=true`);
console.log(`request_path=${path}`);
console.error(`guard passed: ${path} (task=${request.taskId}, safety=${request.safetyLevel})`);
