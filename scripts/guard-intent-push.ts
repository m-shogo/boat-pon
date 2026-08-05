// boat-pon intent-push guard（ubuntu 上で self-hosted runner へ渡す前に実行）。
//
// ChatGPT が commit した最小 intent を検証し、GitHub 側で canonical request を生成する。
// ChatGPT に hash / digest を作らせない。queueDigest / requestDigest は本 guard が計算する。
//
// 検証: exactly-one-added intent / immutable / path / filename↔intentId / strict schema /
//       actor policy / expectedAuthoritySha / task 存在・READY・deps PASS・not RUNNING /
//       replay(processed ledgers) / equivalent pending intent / safety。すべて fail-closed。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { INTENT_ID_RE, buildCanonicalRequest, isIntentProcessed, isRequestReplay, validateIntent } from "../src/automation/dispatchIntent";
import {
  analyzeEquivalentUnprocessedIntents,
  validateIntentSupersession,
  type IntentSupersession,
} from "../src/automation/intentSupersession";
import { computeStateDigest, mergeCatalogAndState, resolveTask, validateCatalog, validateQueueState } from "../src/automation/taskCatalog";

const INTENTS_DIR = "automation/requests/intents";
const SUPERSESSIONS_DIR = "automation/requests/supersessions";
const AUTOMATION_BRANCH = "automation/boat-pon-research";
const MAX_BYTES = 65536;
const out = (k: string, v: string): void => { if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`, { flag: "a" }); };
const fail = (msg: string): never => { console.error(`::error::${msg}`); out("ok", "false"); process.exit(1); };

const before = (process.env.BEFORE_SHA ?? "").trim();
const after = (process.env.AFTER_SHA ?? "").trim();
if (!/^[0-9a-f]{40}$/.test(after)) fail("invalid AFTER_SHA");

// ---- actor policy（wildcard / org / fork 禁止）----
const actorPolicy = JSON.parse(readFileSync("config/actor-allowlist-policy.json", "utf8"));
const actor = (process.env.ACTOR ?? "").trim();
const commitAuthor = (process.env.COMMIT_AUTHOR ?? "").trim();
const commitCommitter = (process.env.COMMIT_COMMITTER ?? "").trim();
const eventName = (process.env.EVENT ?? "").trim();
const repo = (process.env.REPO ?? "").trim();
// connector probe 用: 観測した actor/author/committer/event を sanitized evidence として
// 常に step summary へ記録する（allowlist 判定の前に。actor 未許可でも安全に残る）。
const sanitize = (s: string): string => s.replace(/[^0-9A-Za-z._\-\[\]]/g, "").slice(0, 64);
const actorEvidence = {
  observedActor: sanitize(actor), observedAuthor: sanitize(commitAuthor), observedCommitter: sanitize(commitCommitter),
  event: sanitize(eventName), repository: sanitize(repo), afterSha: after.slice(0, 12),
};
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### boat-pon actor evidence (connector probe)\n\n\`\`\`json\n${JSON.stringify(actorEvidence, null, 2)}\n\`\`\`\n`
    + `\n> 未許可 actor の場合はここに表示された \`observedActor\` を config/actor-allowlist-policy.json に明示追加する。\n`,
    { flag: "a" });
}
out("observed_actor", actorEvidence.observedActor);
out("observed_author", actorEvidence.observedAuthor);
out("observed_committer", actorEvidence.observedCommitter);

if (repo !== actorPolicy.repository) fail(`repo not allowed: ${repo}`);
if (eventName !== "push") fail(`only push events are allowed (got ${eventName})`);
if (actorPolicy.rules?.pullRequestEventAllowed === false && /pull_request/.test(eventName)) fail("pull_request events are not allowed");
const allowed = new Set<string>((actorPolicy.allowedActors ?? []).filter((a: any) => a.verified === true).map((a: any) => a.actor));
if (!allowed.has(actor)) {
  fail(`actor not in verified allowlist: ${actor}. observed actor/author=${actorEvidence.observedAuthor}/committer=${actorEvidence.observedCommitter}. `
    + `probe intent で actor を確認し config/actor-allowlist-policy.json に明示追加するまで許可しない（safe BLOCK）。`);
}

// ---- push diff: 追加された intent が exactly one であること ----
let diff: string;
try {
  const base = /^[0-9a-f]{40}$/.test(before) && before !== "0".repeat(40) ? before : `${after}^`;
  diff = execFileSync("git", ["diff", "--name-status", base, after], { encoding: "utf8" });
} catch { fail("cannot compute push diff"); }
const changes = diff!.split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => { const [status, ...rest] = l.split(/\s+/); return { status, path: rest[rest.length - 1] }; })
  .filter((c) => c.path.startsWith(`${INTENTS_DIR}/`));
if (changes.length === 0) fail("no intent file change in this push");
for (const c of changes) if (c.status !== "A") fail(`intent files are immutable; refused status=${c.status} path=${c.path}`);
if (changes.length !== 1) fail(`exactly one new intent per push is allowed (got ${changes.length})`);

const path = changes[0].path;
if (path.includes("..") || path.startsWith("/")) fail(`unsafe path: ${path}`);
if (!/^automation\/requests\/intents\/INTENT-[0-9A-Za-z._-]{4,64}\.json$/.test(path)) fail(`path must be ${INTENTS_DIR}/INTENT-<id>.json (got ${path})`);
if (!existsSync(path)) fail(`intent file missing: ${path}`);
if (lstatSync(path).isSymbolicLink()) fail("symlink intent file is not allowed");
if (statSync(path).size > MAX_BYTES) fail(`intent file too large: ${statSync(path).size} bytes`);

let rawIntent: unknown;
try { rawIntent = JSON.parse(readFileSync(path, "utf8")); } catch { fail("intent file is not valid JSON"); }
const iv = validateIntent(rawIntent);
if (!iv.valid || !iv.intent) fail(`invalid intent: ${iv.errors.join("; ")}`);
const intent = iv.intent!;
if (!INTENT_ID_RE.test(intent.intentId)) fail("invalid intentId");
if (path !== `${INTENTS_DIR}/${intent.intentId}.json`) fail(`filename must match intentId (expected ${INTENTS_DIR}/${intent.intentId}.json)`);

// ---- expectedAuthoritySha: 最新 main（after / parent）に前方一致 ----
const parent = (() => { try { return execFileSync("git", ["rev-parse", `${after}^`], { encoding: "utf8" }).trim(); } catch { return ""; } })();
const acceptable = [after, parent, before].filter((s) => /^[0-9a-f]{40}$/.test(s));
if (!acceptable.some((sha) => sha.startsWith(intent.expectedAuthoritySha) || intent.expectedAuthoritySha.startsWith(sha))) {
  fail(`stale expectedAuthoritySha: ${intent.expectedAuthoritySha} vs main ${after.slice(0, 12)} / parent ${parent.slice(0, 12)}`);
}

// ---- catalog（main）+ state / ledger（automation branch）をロード ----
const catV = validateCatalog(JSON.parse(readFileSync("automation/task-catalog.json", "utf8")));
if (!catV.valid || !catV.catalog) fail(`invalid catalog: ${catV.errors.join("; ")}`);
try { execFileSync("git", ["fetch", "origin", AUTOMATION_BRANCH, "--quiet"], { stdio: "ignore" }); } catch { fail("cannot fetch automation branch"); }
const showBranch = (p: string): any => {
  try { return JSON.parse(execFileSync("git", ["show", `origin/${AUTOMATION_BRANCH}:${p}`], { encoding: "utf8" })); }
  catch { fail(`cannot read ${p} on ${AUTOMATION_BRANCH}`); }
};
const stV = validateQueueState(showBranch("automation/control/task-queue-state.json"));
if (!stV.valid || !stV.state) fail(`invalid queue state: ${stV.errors.join("; ")}`);
const state = stV.state!;
const processedIntents = (() => { try { return showBranch("automation/control/processed-intents.json"); } catch { return { intentIds: [] }; } })();
const processedRequests = (() => { try { return showBranch("automation/control/processed-requests.json"); } catch { return { requestIds: [], idempotencyKeys: {} }; } })();

// ---- replay: 同 intentId / requestId ----
const requestId = `REQ-${intent.intentId.replace(/^INTENT-/, "")}`;
if (isIntentProcessed(processedIntents, intent.intentId)) fail(`replayed intentId: ${intent.intentId}`);
if (isRequestReplay(processedRequests, requestId)) fail(`replayed requestId: ${requestId}`);

// ---- 同一 task の未処理 intent: active は拒否、stale は明示 supersession のみ許可 ----
const allIntents = readdirSync(INTENTS_DIR)
  .filter((name) => /^INTENT-[0-9A-Za-z._-]{4,64}\.json$/.test(name))
  .map((name) => {
    const candidatePath = `${INTENTS_DIR}/${name}`;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(candidatePath, "utf8")); }
    catch { fail(`existing intent is not valid JSON: ${candidatePath}`); }
    const validation = validateIntent(raw);
    const candidateIntent = validation.intent;
    if (!validation.valid || candidateIntent === null) {
      fail(`invalid existing intent ${candidatePath}: ${validation.errors.join("; ")}`);
    }
    return candidateIntent;
  });

const supersessions: IntentSupersession[] = existsSync(SUPERSESSIONS_DIR)
  ? readdirSync(SUPERSESSIONS_DIR)
      .filter((name) => /^SUPERSESSION-[0-9A-Za-z._-]{4,96}\.json$/.test(name))
      .map((name) => {
        const supersessionPath = `${SUPERSESSIONS_DIR}/${name}`;
        let raw: unknown;
        try { raw = JSON.parse(readFileSync(supersessionPath, "utf8")); }
        catch { fail(`supersession is not valid JSON: ${supersessionPath}`); }
        const validation = validateIntentSupersession(raw);
        const parsedSupersession = validation.supersession;
        if (!validation.valid || parsedSupersession === null) {
          fail(`invalid supersession ${supersessionPath}: ${validation.errors.join("; ")}`);
        }
        if (name !== `${parsedSupersession.supersessionId}.json`) {
          fail(`supersession filename must match supersessionId: ${supersessionPath}`);
        }
        return parsedSupersession;
      })
  : [];

const equivalent = analyzeEquivalentUnprocessedIntents({
  currentIntent: intent,
  allIntents,
  processedIntentIds: Array.isArray(processedIntents.intentIds) ? processedIntents.intentIds : [],
  supersessions,
  acceptableAuthorityShas: acceptable,
});
if (equivalent.blockingIntentIds.length > 0) {
  fail(`equivalent unprocessed intent exists without valid stale supersession: ${equivalent.blockingIntentIds.join(",")}`);
}
if (equivalent.supersededIntentIds.length > 0) {
  console.error(`stale intent supersession accepted: ${equivalent.supersededIntentIds.join(",")} -> ${intent.intentId}`);
  out("superseded_intent_ids", equivalent.supersededIntentIds.join(","));
}

// ---- task 解決（catalog+state）+ READY / deps / not RUNNING ----
const merged = mergeCatalogAndState(catV.catalog!, state);
const resolved = resolveTask(merged, intent.taskId);
if (!resolved.task) fail(resolved.reason);
const task = resolved.task!;
if (task.staleDefinition) fail(`stale task definition: ${task.taskId}（rebase/revalidation 待ち）`);
if (intent.requestedAction !== "dry-run" && intent.requestedAction !== "plan-next") {
  if (task.status !== "READY") fail(`task not READY: ${task.taskId}=${task.status}`);
  const byId = new Map(merged.map((t) => [t.taskId, t]));
  if (!(task.dependencies ?? []).every((d) => byId.get(d)?.status === "PASS")) fail(`dependencies not satisfied for ${task.taskId}`);
}
if (["CLAIMED", "RUNNING"].includes(task.status)) fail(`task already in progress: ${task.status}`);

// ---- safety ----
if (task.safetyLevel === "L4" || intent.safetyLevel === "L3" && !intent.approvalGrantId) {
  if (intent.safetyLevel === "L3" && !intent.approvalGrantId) fail("L3 requires approvalGrantId (existing grant)");
}
if (!["L0", "L1", "L2", "L3"].includes(intent.safetyLevel)) fail("invalid safetyLevel");

// ---- canonical request 生成 ----
const stateDigest = computeStateDigest(state);
const { request, errors } = buildCanonicalRequest({
  intent, authoritySha: after, queueDigest: stateDigest, createdAt: new Date().toISOString(), task,
});
if (errors.length > 0) fail(`canonical request build failed: ${errors.join("; ")}`);

const outPath = process.env.CANONICAL_REQUEST_PATH ?? "canonical-request.json";
writeFileSync(outPath, `${JSON.stringify(request, null, 2)}\n`);
out("ok", "true");
out("intent_path", path);
out("intent_id", intent.intentId);
out("request_id", requestId);
out("canonical_request_path", outPath);
console.error(`guard passed: intent=${intent.intentId} task=${task.taskId} safety=${intent.safetyLevel} action=${intent.requestedAction} → ${requestId}`);
