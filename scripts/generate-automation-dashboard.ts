// boat-pon automation research dashboard（self-contained HTML, read-only）。
// control / runner / research / safety の 4 plane を表示する。
// 値が無い場合は 0 を捏造せず NOT_STARTED / NOT_AVAILABLE / BLOCKED / NOT_APPLICABLE を表示する。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mergeCatalogAndState, validateCatalog, validateQueueState } from "../src/automation/taskCatalog";

const root = resolve(process.cwd());
const R = join(root, "reports/automation");
const NA = "NOT_AVAILABLE";
const BRANCH = "automation/boat-pon-research";

const readJson = (p: string): any | null => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const safe = <T>(fn: () => T, d: T): T => { try { return fn(); } catch { return d; } };
const git = (...a: string[]): string => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const showBranch = (p: string): any | null => safe(() => JSON.parse(execFileSync("git", ["show", `origin/${BRANCH}:${p}`], { cwd: root, encoding: "utf8" })), null);

safe(() => git("fetch", "origin", BRANCH, "--quiet"), "");
const catalog = validateCatalog(readJson(join(root, "automation/task-catalog.json"))).catalog;
const state = validateQueueState(showBranch("automation/control/task-queue-state.json")).state;
const merged = catalog && state ? mergeCatalogAndState(catalog, state) : [];
const status = showBranch("reports/automation/current-status.json") ?? readJson(join(R, "current-status.json"));
const processedReq = showBranch("automation/control/processed-requests.json");
const processedInt = showBranch("automation/control/processed-intents.json");
const planner = showBranch("automation/control/planner-candidates.json");
const edges = showBranch("automation/edge-registry.json");
const experiments = showBranch("automation/experiment-registry.json");
const rejections = showBranch("automation/rejection-registry.json");
const holdouts = showBranch("automation/holdout-registry.json");
const freeze = readJson(join(root, "reports/n2/corrected-settlement-truth-freeze.json"));
const policy = readJson(join(root, "config/research-automation-policy.json"));
const actorPolicy = readJson(join(root, "config/actor-allowlist-policy.json"));

const gitSha = safe(() => git("rev-parse", "HEAD"), NA);
const branchSha = safe(() => git("rev-parse", `origin/${BRANCH}`), NA);
let runner: any = null;
try { runner = JSON.parse(execFileSync("gh", ["api", "repos/m-shogo/boat-pon/actions/runners"], { cwd: root, encoding: "utf8" })).runners?.[0] ?? null; } catch { runner = null; }

const sidecar = join(policy?.dataRoot ?? root, "data/research-replay.sqlite");
const walPath = `${sidecar}-wal`;
const walState = existsSync(walPath) ? (statSync(walPath).size > 0 ? `ACTIVE (${statSync(walPath).size} bytes)` : "empty") : "absent";
const emergencyStop = existsSync(join(root, policy?.guards?.emergencyStopPath ?? "automation/EMERGENCY_STOP"));
const paused = existsSync(join(root, policy?.guards?.pausePath ?? "automation/PAUSED"));

const byStatus = (s: string): number => merged.filter((t) => t.status === s).length;
const byId = new Map(merged.map((x) => [x.taskId, x]));
const readyDispatchable = merged.filter((t) => t.status === "READY" && !t.staleDefinition && (t.dependencies ?? []).every((d) => byId.get(d)?.status === "PASS"));

const esc = (s: unknown): string => String(s ?? NA).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const v = (x: unknown): string => (x === undefined || x === null || x === "" ? NA : esc(x));
const row = (k: string, val: string): string => `<tr><th>${k}</th><td>${val}</td></tr>`;

const taskRows = merged.map((t) => {
  const cls = t.status === "PASS" ? "pass" : t.status === "READY" ? "ready" : t.status.startsWith("BLOCKED") ? "blocked" : t.status.startsWith("FAILED") ? "fail" : "other";
  const digest = t.state?.resultDigest ? String(t.state.resultDigest).slice(0, 12) : NA;
  return `<tr><td>${esc(t.taskId)}</td><td>${esc(t.taskType)}</td><td>${esc(t.safetyLevel)}</td><td class="${cls}">${esc(t.status)}</td><td>${esc((t.dependencies ?? []).join(", ") || "-")}</td><td>${digest}</td></tr>`;
}).join("\n");
const plannerRows = (planner?.candidates ?? []).map((c: any) => `<tr><td>${esc(c.proposedTaskId)}</td><td>${esc(c.taskType)}</td><td>${esc(c.safetyLevel)}</td><td>${esc(c.reason)}</td></tr>`).join("\n") || `<tr><td colspan="4">NOT_STARTED</td></tr>`;

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>boat-pon automation dashboard</title><style>
:root{color-scheme:light dark}body{font-family:ui-sans-serif,system-ui,-apple-system,"Hiragino Sans",sans-serif;margin:0;padding:1.2rem;line-height:1.5}
h1{font-size:1.3rem}h2{font-size:1.05rem;margin-top:1.6rem;border-bottom:2px solid #8884;padding-bottom:.2rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.86rem}th,td{border:1px solid #8884;padding:.3rem .5rem;text-align:left;vertical-align:top}
th{background:#8881;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}
.pass{color:#0a0;font-weight:600}.ready{color:#06c;font-weight:600}.blocked{color:#c60}.fail{color:#c00;font-weight:600}.other{color:#888}
.pill{display:inline-block;padding:.1rem .5rem;border-radius:1rem;background:#8882;font-size:.8rem}code{font-size:.82rem}
.note{color:#888;font-size:.8rem}.overflow{overflow-x:auto}</style></head><body>
<h1>boat-pon automation research dashboard</h1>
<p class="note">生成: ${new Date().toISOString()} / 1 dispatch = 1 task / schedule・cron・daemon なし / 状態正本 = automation branch</p>

<div class="grid">
<div><h2>Control plane</h2><table>
${row("main SHA", `<code>${v(gitSha).slice(0, 12)}</code>`)}
${row("automation branch SHA", `<code>${v(branchSha).slice(0, 12)}</code>`)}
${row("task catalog version", v(catalog?.catalogVersion))}
${row("queue state version", v(state?.stateVersion))}
${row("processed intents", v(processedInt?.intentIds?.length))}
${row("processed requests", v(processedReq?.requestIds?.length))}
${row("idempotency keys", v(processedReq?.idempotencyKeys ? Object.keys(processedReq.idempotencyKeys).length : null))}
${row("last result", `<b>${v(status?.lastResult)}</b>`)}
${row("next READY (dispatchable)", readyDispatchable.length ? readyDispatchable.map((t) => esc(t.taskId)).join(", ") : "NONE (use TASK-PLANNER-NEXT)")}
${row("planner status", planner ? `${v(planner.candidateCount)} candidates` : "NOT_STARTED")}
</table></div>

<div><h2>Runner plane</h2><table>
${row("online", runner ? v(runner.status) : NA)}
${row("busy", runner ? v(runner.busy) : NA)}
${row("last run", v(status?.lastRunId ?? status?.workflowRunId))}
${row("last request", v(status?.lastRequestId))}
${row("last intent", v(status?.lastIntentId))}
${row("last task", v(status?.lastTaskId))}
${row("elapsed", status?.elapsedMs != null ? `${status.elapsedMs} ms` : NA)}
${row("lock", existsSync(join(root, policy?.lock?.path ?? "x")) ? "HELD" : "free")}
</table></div>

<div><h2>Safety plane</h2><table>
${row("allowed safety", v((policy?.allowedSafetyLevels ?? []).join(", ")))}
${row("L3 grants", "existing-grant-required（無ければ exit 3）")}
${row("L4", "DISABLED（常時拒否）")}
${row("sidecar write", "NONE（read-only executors）")}
${row("WAL", v(walState))}
${row("emergency stop", v(emergencyStop))}
${row("paused", v(paused))}
${row("replay guard", "processed-intents / processed-requests + idempotency key")}
${row("actor allowlist", v((actorPolicy?.allowedActors ?? []).filter((a: any) => a.verified).map((a: any) => a.actor).join(", ")) + " <span class='note'>(wildcard/org/fork 禁止)</span>")}
${row("corrected truth", v(freeze?.correctedTruthVersion))}
</table></div>
</div>

<h2>Research tasks（定義=main / 状態=automation branch）</h2>
<p><span class="pill">PASS ${byStatus("PASS")}</span> <span class="pill">READY ${byStatus("READY")}</span> <span class="pill">BLOCKED_EXECUTOR_PENDING ${byStatus("BLOCKED_EXECUTOR_PENDING")}</span> <span class="pill">FAILED ${byStatus("FAILED_FINAL") + byStatus("FAILED_RETRYABLE")}</span></p>
<div class="overflow"><table><thead><tr><th>taskId</th><th>taskType</th><th>safety</th><th>status</th><th>deps</th><th>resultDigest</th></tr></thead><tbody>
${taskRows || `<tr><td colspan="6">NOT_AVAILABLE</td></tr>`}
</tbody></table></div>

<h2>Planner candidates（自動 dispatch しない）</h2>
<div class="overflow"><table><thead><tr><th>proposedTaskId</th><th>taskType</th><th>safety</th><th>reason</th></tr></thead><tbody>
${plannerRows}
</tbody></table></div>

<h2>Research registries</h2>
<table>
${row("edge registry", v(edges?.edges?.length != null ? `${edges.edges.length} edges` : null))}
${row("experiment registry", v(experiments?.experiments?.length != null ? `${experiments.experiments.length} experiments` : null))}
${row("rejection registry", v(rejections?.rejections?.length != null ? `${rejections.rejections.length} rejections` : null))}
${row("holdout registry", v(holdouts?.vaults?.length != null ? `${holdouts.vaults.length} vaults` : null))}
${row("shadow-forward", "NOT_STARTED（baseline/evaluation 後）")}
</table>
<p class="note">production 昇格・BUY 条件・app_settings・sidecar write は本 automation の対象外（禁止）。</p>
</body></html>`;

mkdirSync(R, { recursive: true });
writeFileSync(join(R, "research-dashboard.html"), html);
console.log(JSON.stringify({
  wrote: "reports/automation/research-dashboard.html",
  catalogVersion: catalog?.catalogVersion ?? NA, stateVersion: state?.stateVersion ?? NA,
  pass: byStatus("PASS"), ready: byStatus("READY"), dispatchable: readyDispatchable.map((t) => t.taskId),
  runner: runner?.status ?? NA,
}, null, 2));
