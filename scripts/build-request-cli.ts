// request JSON builder（ChatGPT / operator が pending へ commit する 1 件を生成する）。
// canonicalization は scripts/build-research-request.mjs と同一式（requestDigest 自身を除く
// canonical JSON の SHA-256）。ループ・schedule は持たない。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const arg = (n: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`--${n}=`));
  if (d) return d.slice(n.length + 3);
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const fail = (m: string): never => { console.error(`invalid input: ${m}`); process.exit(1); };

const taskId = arg("task-id") ?? fail("--task-id");
const requestedAction = arg("requested-action") ?? "run-task";
const safetyLevel = arg("safety-level") ?? "L0";
const requestReference = arg("request-reference");
const requestedBy = arg("requested-by") ?? "chatgpt-scheduled-task";
const maxDurationSeconds = Number(arg("max-duration-seconds") ?? "1800");
const write = process.argv.includes("--write");

if (!/^(TASK-[0-9A-Za-z._-]{1,64}|NEXT)$/.test(taskId)) fail("task-id");
if (!["run-task", "run-next", "status-only", "dry-run"].includes(requestedAction)) fail("requested-action");
if (requestedAction === "run-next" && taskId !== "NEXT") fail("run-next requires task-id NEXT");
if (taskId === "NEXT" && !["status-only", "dry-run"].includes(requestedAction)) fail("executing NEXT requires intent dispatch");
if (!["L0", "L1", "L2"].includes(safetyLevel)) fail("safety-level (legacy builder supports L0/L1/L2 only; L3 requires intent dispatch with a pre-existing grant; L4 is never automated)");
if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 60 || maxDurationSeconds > 21600) fail("max-duration-seconds");

// authority SHA は origin/main の現在値を既定にする（明示指定も可）。
const authoritySha = (arg("authority-sha") ?? (() => {
  try { execFileSync("git", ["fetch", "origin", "--quiet"], { cwd: root }); } catch { /* offline ok */ }
  return execFileSync("git", ["rev-parse", "--short", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
})()).toLowerCase();
if (!/^[0-9a-f]{7,40}$/.test(authoritySha)) fail("authority-sha");

const queue = JSON.parse(readFileSync(join(root, "automation/task-queue.json"), "utf8"));
const queueDigest = createHash("sha256").update(JSON.stringify(queue)).digest("hex");

const suffix = createHash("sha256").update(`${taskId}|${Date.now()}|${authoritySha}`).digest("hex").slice(0, 10);
const requestId = arg("request-id") ?? `REQ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${suffix}`;
if (!/^REQ-[0-9A-Za-z._-]{4,64}$/.test(requestId)) fail("request-id");

const request: Record<string, unknown> = {
  requestSchemaVersion: "research-task-request-v1",
  requestId, taskId, requestedAction, safetyLevel, authoritySha, queueDigest,
  createdAt: new Date().toISOString(), requestedBy, maxDurationSeconds,
  expectedOutput: "reports/automation/current-status.json",
  approvalRequirement: "none",
  ...(requestReference ? { requestReference } : {}),
  ...(["dry-run", "status-only"].includes(requestedAction) ? { dryRun: true } : {}),
};
request.requestDigest = createHash("sha256")
  .update(JSON.stringify(request, Object.keys(request).sort())).digest("hex");

const outPath = join(root, "automation/requests/pending", `${requestId}.json`);
const body = `${JSON.stringify(request, null, 2)}\n`;
if (write) {
  mkdirSync(join(root, "automation/requests/pending"), { recursive: true });
  writeFileSync(outPath, body);
  console.error(`wrote ${outPath}`);
}
process.stdout.write(body);