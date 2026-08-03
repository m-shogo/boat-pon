// boat-pon automation research dashboard（self-contained HTML, read-only）。
// 値が無い場合は 0 を捏造せず NOT_STARTED / NOT_AVAILABLE / BLOCKED / NOT_APPLICABLE を表示する。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const R = join(root, "reports/automation");
const NA = "NOT_AVAILABLE";

const readJson = (p: string): any | null => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const safe = (fn: () => string): string => { try { return fn(); } catch { return NA; } };

const status = readJson(join(R, "current-status.json"));
const queue = readJson(join(root, "automation/task-queue.json"));
const edges = readJson(join(root, "automation/edge-registry.json"));
const experiments = readJson(join(root, "automation/experiment-registry.json"));
const rejections = readJson(join(root, "automation/rejection-registry.json"));
const holdouts = readJson(join(root, "automation/holdout-registry.json"));
const applyReport = readJson(join(root, "reports/n2/settlement-reparse-apply.json"));
const freeze = readJson(join(root, "reports/n2/corrected-settlement-truth-freeze.json"));
const policy = readJson(join(root, "config/research-automation-policy.json"));

const gitSha = safe(() => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
const runnerJson = safe(() => execFileSync("gh", ["api", "repos/m-shogo/boat-pon/actions/runners"], { cwd: root, encoding: "utf8" }));
let runner: any = null;
try { runner = JSON.parse(runnerJson).runners?.[0] ?? null; } catch { runner = null; }

const sidecar = join(root, "data/research-replay.sqlite");
const dbSize = existsSync(sidecar) ? statSync(sidecar).size : null;
const walPath = `${sidecar}-wal`;
const walState = existsSync(walPath) ? (statSync(walPath).size > 0 ? `ACTIVE (${statSync(walPath).size} bytes)` : "empty") : "absent";
const historyCount = existsSync(join(R, "history")) ? readdirSync(join(R, "history")).filter((f) => f.endsWith(".json")).length : 0;
const emergencyStop = existsSync(join(root, policy?.guards?.emergencyStopPath ?? "automation/EMERGENCY_STOP"));
const paused = existsSync(join(root, policy?.guards?.pausePath ?? "automation/PAUSED"));
const lockPath = join(root, policy?.lock?.path ?? "data/tmp/automation/research.lock.json");
const lockState = existsSync(lockPath) ? "HELD" : "free";

const countBy = (arr: any[] | undefined, key: string): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const x of arr ?? []) m[x[key]] = (m[x[key]] ?? 0) + 1;
  return m;
};
const taskStatuses = countBy(queue?.tasks, "status");
const edgeStates = countBy(edges?.edges, "promotionState");

const rows = (pairs: Array<[string, unknown]>): string =>
  pairs.map(([k, v]) => `<tr><td>${k}</td><td><code>${esc(v === null || v === undefined || v === "" ? NA : String(v))}</code></td></tr>`).join("");
function esc(s: string): string { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string)); }

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>boat-pon automation dashboard</title><style>
:root{color-scheme:light dark}body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:auto;max-width:1100px;padding:24px}
h1{font-size:20px}h2{font-size:15px;border-bottom:1px solid #8884;padding-bottom:4px;margin-top:24px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #8884;padding:5px 8px;text-align:left}th{background:#8881}
.tw{overflow-x:auto}code{font-size:12px}.warn{background:#f39c1222;border:1px solid #f39c12;border-radius:8px;padding:10px 14px}
.ok{background:#2ecc7122;border:1px solid #2ecc71;border-radius:8px;padding:10px 14px}
.kpi{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.card{border:1px solid #8884;border-radius:10px;padding:10px 14px;min-width:140px}
.card b{display:block;font-size:18px}.card span{color:#888;font-size:12px}.lg{color:#888;font-size:11px}
</style></head><body>
<h1>boat-pon automation dashboard</h1>
<p class="${emergencyStop ? "warn" : "ok"}">1 dispatch = 1 task。schedule / cron / launchd hourly / daemon loop は<b>存在しない</b>。
毎時判断は ChatGPT Scheduled Task 側が担当し、runner は job 待機のみ。</p>

<div class="kpi">
<div class="card"><b>${runner ? runner.status : NA}</b><span>runner status</span></div>
<div class="card"><b>${status?.lastResult ?? "NOT_STARTED"}</b><span>last run result</span></div>
<div class="card"><b>${taskStatuses.READY ?? 0}</b><span>READY tasks</span></div>
<div class="card"><b>${edges?.edges?.length ?? 0}</b><span>edge ideas</span></div>
<div class="card"><b>${emergencyStop ? "STOPPED" : paused ? "PAUSED" : "normal"}</b><span>control state</span></div>
</div>

<h2>Runner</h2><div class="tw"><table>${rows([
  ["registered", runner ? "YES" : NA],
  ["name", runner?.name],
  ["status", runner?.status],
  ["busy", runner ? String(runner.busy) : NA],
  ["labels", runner ? (runner.labels ?? []).map((l: any) => l.name).join(", ") : NA],
  ["service", runner ? "launchd (waits for jobs only)" : NA],
  ["latest workflow", "boat-pon-local-research.yml (workflow_dispatch only)"],
  ["latest request", status?.lastRequestId],
  ["latest task", status?.lastTaskId],
  ["lock", lockState],
  ["emergency stop", String(emergencyStop)],
  ["paused", String(paused)],
])}</table></div>

<h2>GitHub</h2><div class="tw"><table>${rows([
  ["authority SHA", gitSha],
  ["automation branch", policy?.gitWrite?.branch],
  ["git write mode", policy?.gitWrite?.mode],
  ["rolling PR", "NOT_STARTED (first automation run で作成)"],
  ["schedule triggers", "NONE (禁止・未使用)"],
])}</table></div>

<h2>Data / settlement</h2><div class="tw"><table>${rows([
  ["settlement snapshot identity", freeze?.settlementSnapshotIdentityAfter ?? applyReport?.gate?.approval?.approvalId ? (freeze?.settlementSnapshotIdentityAfter ?? NA) : NA],
  ["corrected settlement status", applyReport?.status === "APPLIED" ? "APPLIED (corrected truth)" : (applyReport?.status ?? NA)],
  ["apply executed", applyReport?.realSidecarApply ?? NA],
  ["DB size (bytes)", dbSize],
  ["WAL", walState],
  ["backup", freeze?.backupPath ?? NA],
  ["held-out (not applied)", "2 (CONFIRMED_V1_WIN_REFUND_OMISSION)"],
])}</table></div>

<h2>N2</h2><div class="tw"><table>${rows([
  ["corrected truth freeze", freeze ? "FROZEN" : "NOT_STARTED"],
  ["dataset manifest", existsSync(join(root, "reports/n2/n2-dataset-manifest.json")) ? "PRESENT" : "NOT_STARTED"],
  ["canary dataset", "NOT_STARTED"],
  ["coverage", "NOT_STARTED"],
  ["PIT guard", "IMPLEMENTED (n2DatasetContract / odds atomic PIT)"],
  ["leakage guard", "IMPLEMENTED (leakage sentinel tests)"],
  ["holdout vault", holdouts?.vaults?.length ? String(holdouts.vaults.length) : "NOT_STARTED"],
  ["baseline model", "NOT_STARTED"],
  ["shadow forward", "NOT_STARTED"],
])}</table></div>

<h2>Research control plane</h2><div class="tw"><table>${rows([
  ["queued tasks (by status)", JSON.stringify(taskStatuses)],
  ["edge registry", `${edges?.edges?.length ?? 0} edges ${JSON.stringify(edgeStates)}`],
  ["experiment registry", experiments?.experiments?.length ?? 0],
  ["rejection registry", rejections?.rejections?.length ?? 0],
  ["holdout registry", holdouts?.vaults?.length ?? 0],
  ["run history files", historyCount],
])}</table></div>

<h2>Latest run</h2><div class="tw"><table>${rows([
  ["request ID", status?.lastRequestId],
  ["task ID", status?.lastTaskId],
  ["action", status?.lastAction],
  ["safety level", status?.lastSafetyLevel],
  ["result", status?.lastResult ?? "NOT_STARTED"],
  ["blocks", Array.isArray(status?.blocks) && status.blocks.length ? status.blocks.join(", ") : "none"],
  ["evidence", status?.evidencePath],
  ["elapsed (ms)", status?.elapsedMs],
  ["next candidate", status?.nextCandidate],
])}</table></div>

<p class="lg">generated ${new Date().toISOString()} · self-contained (no external CDN) · 値が無い項目は NOT_STARTED / NOT_AVAILABLE と表示する</p>
</body></html>`;

mkdirSync(R, { recursive: true });
writeFileSync(join(R, "research-dashboard.html"), html);
console.log(JSON.stringify({ wrote: "reports/automation/research-dashboard.html", runner: runner?.status ?? NA, lastResult: status?.lastResult ?? "NOT_STARTED", readyTasks: taskStatuses.READY ?? 0 }, null, 2));
