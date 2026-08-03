// workflow inputs（env 経由）から strict request JSON を組み立てる。
// shell へ ${{ }} を展開せず、値はすべて env から読み、形式検証してから JSON 化する。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const env = (name) => (process.env[name] ?? "").trim();
const fail = (msg) => { console.error(`invalid input: ${msg}`); process.exit(1); };

const taskId = env("TASK_ID");
const requestedAction = env("REQUESTED_ACTION");
const safetyLevel = env("SAFETY_LEVEL");
const authoritySha = env("AUTHORITY_SHA").toLowerCase();
const maxDurationRaw = env("MAX_DURATION") || "1800";
const requestReference = env("REQUEST_REFERENCE");
const runId = env("RUN_ID") || "local";
const actor = env("ACTOR") || "unknown";

if (!/^(TASK-[0-9A-Za-z._-]{1,64}|NEXT)$/.test(taskId)) fail("task_id");
if (!["run-task", "run-next", "status-only", "dry-run"].includes(requestedAction)) fail("requested_action");
if (!["L0", "L1", "L2", "L3"].includes(safetyLevel)) fail("safety_level (L4 is never automated)");
if (!/^[0-9a-f]{7,40}$/.test(authoritySha)) fail("authority_sha");
const maxDurationSeconds = Number(maxDurationRaw);
if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 60 || maxDurationSeconds > 21600) fail("max_duration_seconds");
if (requestReference && !/^[0-9A-Za-z._:/# -]{1,200}$/.test(requestReference)) fail("request_reference");
if (!/^[0-9A-Za-z-]{1,64}$/.test(runId)) fail("run id");
if (!/^[0-9A-Za-z._-]{1,64}$/.test(actor)) fail("actor");

const queue = JSON.parse(readFileSync("automation/task-queue.json", "utf8"));
const queueDigest = createHash("sha256").update(JSON.stringify(queue)).digest("hex");

const request = {
  requestSchemaVersion: "research-task-request-v1",
  requestId: `REQ-run-${runId}`,
  taskId,
  requestedAction,
  safetyLevel,
  authoritySha,
  queueDigest,
  createdAt: new Date().toISOString(),
  requestedBy: `github-actions:${actor}`,
  maxDurationSeconds,
  expectedOutput: "reports/automation/current-status.json",
  approvalRequirement: safetyLevel === "L3" ? "existing-grant-required" : "none",
  ...(requestReference ? { requestReference } : {}),
  ...(requestedAction === "dry-run" ? { dryRun: true } : {}),
};
const canonical = JSON.stringify(request, Object.keys(request).sort());
request.requestDigest = createHash("sha256").update(canonical).digest("hex");
process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
