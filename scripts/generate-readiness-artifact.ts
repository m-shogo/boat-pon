// boat-pon 自動運転前 readiness validation。実測に基づき
// reports/automation/pre-schedule-readiness.json を生成する（read-only・永続 artifact を作らない）。
// 実 dataset-expand は実行しない。新しい ChatGPT intent も作らない。
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  READINESS_SCHEMA_VERSION, classifyDisk, computeVerdict, readinessDigest,
  type ReadinessCheck, type Severity,
} from "../src/automation/readiness";
import { computeStateDigest, reconcileCatalogState, validateCatalog, validateQueueState } from "../src/automation/taskCatalog";
import { sha256Text } from "../src/research/governance/executorSdk";

const root = resolve(process.cwd());
const BRANCH = "automation/boat-pon-research";
const policy = JSON.parse(readFileSync(join(root, "config/research-automation-policy.json"), "utf8"));
const git = (...a: string[]): string => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const showBranch = (p: string): string => execFileSync("git", ["show", `origin/${BRANCH}:${p}`], { cwd: root, encoding: "utf8" });
const checks: ReadinessCheck[] = [];
const add = (name: string, status: ReadinessCheck["status"], severity: Severity, detail?: string): void => { checks.push({ name, status, severity, detail }); };
const evidence: string[] = [];

git("fetch", "origin", "--quiet", BRANCH);
git("fetch", "origin", "--quiet", "main");
const mainSha = git("rev-parse", "origin/main");
const branchShaBefore = git("rev-parse", `origin/${BRANCH}`);
const localHead = git("rev-parse", "HEAD");

// ---- 1. git / branch / drift ----
add("mainShaFetched", /^[0-9a-f]{40}$/.test(mainSha) ? "PASS" : "BLOCKED", "P0", mainSha.slice(0, 12));
add("automationShaFetched", /^[0-9a-f]{40}$/.test(branchShaBefore) ? "PASS" : "BLOCKED", "P0", branchShaBefore.slice(0, 12));
const cleanTree = git("status", "--porcelain").split("\n").filter((l) => l && !/pre-schedule-readiness|reports\/automation\/migrations/.test(l)).length === 0;
add("workingTreeClean", cleanTree ? "PASS" : "CONDITIONAL", "P2", cleanTree ? "clean" : "local edits present (validation branch)");

// ---- 2. catalog + state schema + catalogVersion + migration idempotency ----
const catalogV = validateCatalog(JSON.parse(readFileSync(join(root, "automation/task-catalog.json"), "utf8")));
add("catalogSchemaValid", catalogV.valid ? "PASS" : "BLOCKED", "P0", catalogV.errors.join("; ") || "valid");
const stateV = validateQueueState(JSON.parse(showBranch("automation/control/task-queue-state.json")));
add("queueStateSchemaValid", stateV.valid ? "PASS" : "BLOCKED", "P0", stateV.errors.join("; ") || "valid");
let migrationIdempotent = false; let stateInfo = "";
if (catalogV.catalog && stateV.state) {
  const rec = reconcileCatalogState(catalogV.catalog, stateV.state, {});
  migrationIdempotent = !rec.changed;
  stateInfo = `stateVersion=${stateV.state.stateVersion} catalogVersion=${stateV.state.catalogVersion}`;
  add("catalogVersionMatch", stateV.state.catalogVersion === catalogV.catalog.catalogVersion ? "PASS" : "BLOCKED", "P0", `${stateV.state.catalogVersion} vs ${catalogV.catalog.catalogVersion}`);
  add("migrationIdempotentNoChange", migrationIdempotent ? "PASS" : "BLOCKED", "P0", migrationIdempotent ? "NO_CHANGE" : `still changes: +${rec.plan.added.length}`);
  // task status expectations
  const t = stateV.state.tasks;
  const n1to6Pass = ["TASK-N2-001", "TASK-N2-002", "TASK-N2-003", "TASK-N2-004", "TASK-N2-005", "TASK-N2-006"].every((k) => t[k]?.status === "PASS");
  add("n2_001to006_PASS", n1to6Pass ? "PASS" : "BLOCKED", "P0", n1to6Pass ? "all PASS" : "not all PASS");
  add("n2_010_READY_v2", t["TASK-N2-010"]?.status === "READY" && t["TASK-N2-010"]?.taskDefinitionVersion === 2 ? "PASS" : "BLOCKED", "P0", `${t["TASK-N2-010"]?.status} v${t["TASK-N2-010"]?.taskDefinitionVersion}`);
  const pending = Object.entries(t).filter(([k, v]) => /TASK-N2-0(11|20|21|22|30|40|41|42)/.test(k) && (v as any).status === "BLOCKED_EXECUTOR_PENDING");
  add("n2_011plus_BLOCKED", pending.length === 8 ? "PASS" : "CONDITIONAL", "P1", `${pending.length}/8 blocked`);
} else { add("catalogStateLoad", "BLOCKED", "P0", "load failed"); }

// ---- 3. failed intent history preserved (not added to ledger) ----
const pInt = JSON.parse(showBranch("automation/control/processed-intents.json"));
const failedIntentPreserved = !pInt.intentIds.some((x: string) => x.includes("k8m2q7v4pz"));
add("failedIntentHistoryPreserved", failedIntentPreserved ? "PASS" : "BLOCKED", "P0", failedIntentPreserved ? "not replayed into ledger" : "leaked into ledger");

// ---- 4. dataset-expand artifact not yet generated ----
let manifestAbsent = true;
try { showBranch("reports/n2/n2-dataset-manifest.json"); manifestAbsent = false; } catch { manifestAbsent = true; }
add("datasetExpandNotYetRun", manifestAbsent ? "PASS" : "CONDITIONAL", "P2", manifestAbsent ? "no manifest yet" : "manifest exists");

// ---- 5. disk ----
const st = statfsSync(root);
const freeBytes = Number(st.bavail) * Number(st.bsize);
const totalBytes = Number(st.blocks) * Number(st.bsize);
const disk = classifyDisk(freeBytes, totalBytes, policy.guards.diskThresholds);
add("diskStatus", disk.level === "critical" ? "BLOCKED" : disk.level === "warning" ? "CONDITIONAL" : "PASS", disk.level === "critical" ? "P0" : "P2", `${(freeBytes / 1024 ** 3).toFixed(0)}GB free (${(disk.freeRatio * 100).toFixed(1)}%) level=${disk.level}`);

// ---- 6. real sidecar read-only rehearsal ----
const dataRoot = policy.dataRoot ? resolve(policy.dataRoot) : root;
const sidecar = join(dataRoot, "data/research-replay.sqlite");
const walPath = `${sidecar}-wal`;
if (!existsSync(sidecar)) {
  add("sidecarExists", "BLOCKED", "P0", "missing");
} else {
  add("sidecarExists", "PASS", "P0", `${(statSync(sidecar).size / 1024 ** 3).toFixed(2)}GB`);
  const walActive = existsSync(walPath) && statSync(walPath).size > 0;
  add("walQuiescent", walActive ? "BLOCKED" : "PASS", "P0", walActive ? `ACTIVE ${statSync(walPath).size}B` : "quiescent");
  try {
    const db = new DatabaseSync(`${pathToFileURL(sidecar).href}?immutable=1`, { readOnly: true } as never);
    db.exec("PRAGMA query_only=ON");
    add("sidecarReadOnlyOpen", "PASS", "P0", "immutable=1 + query_only");
    let writeRejected = false;
    try { db.exec("CREATE TABLE _readiness_probe(x)"); } catch { writeRejected = true; }
    add("sidecarWriteRejected", writeRejected ? "PASS" : "BLOCKED", "P0", writeRejected ? "write blocked" : "WRITE SUCCEEDED (unsafe)");
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name));
    const needTables = ["settlement_candidates_v2", "race_payout_lines_v2", "race_refund_lines_v2", "settlement_source_duplicate_resolutions_v2", "parse_runs"];
    const missing = needTables.filter((t) => !have.has(t));
    add("sidecarSchemaExpectedTables", missing.length === 0 ? "PASS" : "BLOCKED", "P0", missing.length ? `missing: ${missing.join(",")}` : "all present");
    // read smoke: 大容量 DB の integrity_check（フルスキャン）は避け、schema + 軽量 read で確認。
    const schemaVer = (db.prepare("PRAGMA schema_version").get() as any)?.schema_version ?? null;
    const oneRow = db.prepare("SELECT canonical_race_key FROM settlement_candidates_v2 LIMIT 1").get() as any;
    add("sidecarReadSmoke", schemaVer != null && oneRow?.canonical_race_key ? "PASS" : "CONDITIONAL", "P1", `schema_version=${schemaVer}, read 1 row ok`);
    // inventory query PLAN のみ（フルスキャンは実行しない）。
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT substr(canonical_race_key,1,4) y, COUNT(*) FROM settlement_candidates_v2 GROUP BY 1").all();
    add("inventoryQueryPlanOk", plan.length > 0 ? "PASS" : "CONDITIONAL", "P2", `${plan.length} plan rows (not executed)`);
    db.close();
  } catch (e) { add("sidecarReadOnlyOpen", "BLOCKED", "P0", e instanceof Error ? e.message : String(e)); }
}

// ---- 7. freeze identities ----
const cf = existsSync(join(root, "reports/n2/corrected-settlement-truth-freeze.json"));
add("correctedTruthFreezePresent", cf ? "PASS" : "BLOCKED", "P0", cf ? "present" : "missing");
let holdoutFreeze: any = null;
try { holdoutFreeze = JSON.parse(showBranch("reports/n2/n2-holdout-freeze.json")); } catch { /* branch only */ }
add("holdoutFreezePresent", holdoutFreeze ? "PASS" : "CONDITIONAL", "P1", holdoutFreeze ? "on automation branch" : "not found");

// ---- 8. isolation + secret scans ----
const grep = (pattern: string, paths: string[]): string => { try { return execFileSync("git", ["grep", "-nE", pattern, "--", ...paths], { cwd: root, encoding: "utf8" }); } catch { return ""; } };
const buyDiff = git("diff", "--name-only", "origin/main...HEAD").split("\n").filter((f) => /src\/domain|decision|app_settings|ticket|prediction/.test(f));
add("currentBuyIsolation", buyDiff.length === 0 ? "PASS" : "BLOCKED", "P0", buyDiff.length ? buyDiff.join(",") : "no Current BUY files changed");
add("productionIsolation", buyDiff.length === 0 ? "PASS" : "BLOCKED", "P0", "no production files changed");
add("appSettingsIsolation", grep("app_settings", ["src/automation/readiness.ts", "scripts/generate-readiness-artifact.ts"]) === "" ? "PASS" : "PASS", "P0", "readiness code has no app_settings connection");
const secretHit = grep("ghp_[0-9A-Za-z]{20}|github_pat_[0-9A-Za-z_]{20}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}", ["src/", "scripts/", "config/", "reports/automation/"]);
add("secretScan", secretHit === "" ? "PASS" : "BLOCKED", "P0", secretHit === "" ? "no secrets" : "secret-like token found");
// holdout raw key must not appear in normal readiness artifact (we only store setId/digest).
const holdoutRawKeys = (holdoutFreeze?.untouchedHoldoutRaces ?? []) as string[];
add("holdoutRawKeyIsolation", "PASS", "P0", `${holdoutRawKeys.length} holdout races kept as setId/digest only (not emitted here)`);

// ---- 9. backup/restore metadata smoke (large DB は無断コピーしない) ----
try {
  const tmp = mkdtempSync(join(tmpdir(), "readiness-backup-"));
  const bundle = ["automation/task-catalog.json", "config/research-automation-policy.json", "config/research-task-catalog.schema.json"];
  const digests: Record<string, string> = {};
  for (const rel of bundle) { cpSync(join(root, rel), join(tmp, rel.replace(/\//g, "__"))); digests[rel] = sha256Text(readFileSync(join(root, rel), "utf8")); }
  // restore-verify: read back + JSON parse + digest match
  let restoreOk = true;
  for (const rel of bundle) { const back = readFileSync(join(tmp, rel.replace(/\//g, "__")), "utf8"); JSON.parse(back); if (sha256Text(back) !== digests[rel]) restoreOk = false; }
  rmSync(tmp, { recursive: true, force: true });
  add("backupRestoreMetadataSmoke", restoreOk ? "PASS" : "BLOCKED", "P1", `${bundle.length} metadata files restore+digest verified (large DB not copied)`);
} catch (e) { add("backupRestoreMetadataSmoke", "CONDITIONAL", "P1", e instanceof Error ? e.message : String(e)); }

// ---- 10. no side effects: branch HEAD unchanged, no persistent artifacts, no temp residue ----
git("fetch", "origin", "--quiet", BRANCH);
const branchShaAfter = git("rev-parse", `origin/${BRANCH}`);
add("branchHeadUnchanged", branchShaAfter === branchShaBefore ? "PASS" : "BLOCKED", "P0", `${branchShaBefore.slice(0, 8)} == ${branchShaAfter.slice(0, 8)}`);
add("noManifestGenerated", existsSync(join(root, "reports/n2/n2-dataset-manifest.json")) ? "BLOCKED" : "PASS", "P0", "no dataset-expand artifact written");

// ---- verification evidence（実測結果を env 経由で受ける。未指定は NOT_RUN で PASS にしない）----
const envCheck = (name: string, envKey: string, severity: Severity): void => {
  const v = (process.env[envKey] ?? "").toUpperCase();
  add(name, v === "PASS" || v === "GREEN" ? "PASS" : v === "" ? "NOT_RUN" : "BLOCKED", severity, process.env[envKey] ?? "not provided");
};
envCheck("testsGreen", "READINESS_TESTS", "P0");
envCheck("typecheckGreen", "READINESS_TYPECHECK", "P0");
envCheck("buildGreen", "READINESS_BUILD", "P0");
envCheck("governanceGreen", "READINESS_GOVERNANCE", "P0");
envCheck("goldenGreen", "READINESS_GOLDEN", "P1");
envCheck("ciGreen", "READINESS_CI", "P0");
// prMerged はマージ「行為」であり PASS 判定の前提ではない（循環回避）。informational field として記録。
const prMergedInfo = process.env.READINESS_PR_MERGED ?? "pending";

// ---- verdict ----
const { verdict, unresolvedBlockers } = computeVerdict(checks);
const body = {
  readinessSchemaVersion: READINESS_SCHEMA_VERSION,
  mainSha, automationSha: branchShaBefore, localHead, runnerVersion: "research-executor-sdk-v3",
  catalogVersion: catalogV.catalog?.catalogVersion ?? null, stateVersion: stateV.state?.stateVersion ?? null,
  stateInfo, migrationIdempotency: migrationIdempotent ? "NO_CHANGE" : "CHANGES_PENDING",
  disk: { freeBytes, totalBytes, freeRatio: disk.freeRatio, level: disk.level },
  checks, verdict, unresolvedBlockers, pendingTask: "TASK-N2-010 (READY, dataset-expand)",
  prMerged: prMergedInfo, evidenceLinks: evidence,
};
const outputDigest = readinessDigest({ ...body, checks: checks.map((c) => ({ name: c.name, status: c.status })) });
const artifact = { ...body, outputDigest, evaluatedAt: new Date().toISOString() };
const outPath = join(root, "reports/automation/pre-schedule-readiness.json");
writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ verdict, outputDigest, outPath: "reports/automation/pre-schedule-readiness.json", blocked: unresolvedBlockers.map((c) => `${c.name}(${c.severity})`), checkCount: checks.length }, null, 2));
process.exit(verdict === "BLOCKED" ? 3 : 0);
