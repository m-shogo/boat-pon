// boat-pon catalog↔queue-state reconciliation（正式 migration 経路。手動 JSON 編集をしない）。
//
// main の task-catalog と automation branch の queue-state を比較し、既存状態・証拠を壊さず
// 新規 task だけを安全に追加する。CAS（branch HEAD 不変）・atomic write・readback・digest 確認。
// 変更が無ければ NO_CHANGE（commit なし・stateVersion 不変）。
//
// 使い方:
//   dry-run（既定・書き込みなし）: tsx scripts/reconcile-catalog-state.ts
//   apply（automation branch へ commit）: tsx scripts/reconcile-catalog-state.ts --apply
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeStateDigest, reconcileCatalogState, validateCatalog, validateQueueState } from "../src/automation/taskCatalog";
import { atomicWriteJson, verifyJsonReadback } from "../src/research/governance/executorSdk";

const root = resolve(process.cwd());
const BRANCH = "automation/boat-pon-research";
const CONTROL_FILES = ["task-queue-state", "processed-intents", "processed-requests", "current-run", "planner-candidates"];
const apply = process.argv.includes("--apply");
const git = (...a: string[]): string => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const showBranch = (p: string): string => execFileSync("git", ["show", `origin/${BRANCH}:${p}`], { cwd: root, encoding: "utf8" });
const die = (msg: string): never => { console.error(`::error::${msg}`); process.exit(1); };

// 1. main authority: catalog を読む・検証する。
const catalogV = validateCatalog(JSON.parse(readFileSync(join(root, "automation/task-catalog.json"), "utf8")));
if (!catalogV.valid || !catalogV.catalog) die(`catalog invalid: ${catalogV.errors.join("; ")}`);
const catalog = catalogV.catalog!;

// 2. branch state を読む・検証する（CAS base SHA を記録）。
git("fetch", "origin", BRANCH, "--quiet");
const baseSha = git("rev-parse", `origin/${BRANCH}`);
const stateV = validateQueueState(JSON.parse(showBranch("automation/control/task-queue-state.json")));
if (!stateV.valid || !stateV.state) die(`queue-state invalid: ${stateV.errors.join("; ")}`);
const state = stateV.state!;

// 3. reconcile plan（決定的）。
const now = new Date().toISOString();
const { changed, plan, nextState } = reconcileCatalogState(catalog, state, { now });
const report = {
  reconciliationVersion: "catalog-state-reconcile-v1",
  baseBranchSha: baseSha, at: now,
  fromCatalogVersion: state.catalogVersion, toCatalogVersion: catalog.catalogVersion,
  fromStateVersion: state.stateVersion, toStateVersion: nextState.stateVersion,
  fromStateDigest: computeStateDigest(state), toStateDigest: computeStateDigest(nextState),
  changed, plan,
};
console.log(JSON.stringify(report, null, 2));

if (!changed) { console.error("NO_CHANGE: catalog and queue-state already reconciled; no commit"); process.exit(0); }
if (!apply) { console.error("DRY_RUN: changes above are NOT written (pass --apply to migrate the automation branch)"); process.exit(0); }

// 4. apply: control state を working tree に materialize（他 control file は削除扱いにしないため全部）。
const controlDir = join(root, "automation/control");
mkdirSync(controlDir, { recursive: true });
for (const f of CONTROL_FILES) {
  try { atomicWriteJson(join(controlDir, `${f}.json`), JSON.parse(showBranch(`automation/control/${f}.json`)), true); }
  catch { /* 一部 control file が無くても続行（新規は runner が作る） */ }
}
// 5. reconciled state を atomic write + readback + digest 確認。
const statePath = join(controlDir, "task-queue-state.json");
const writtenDigest = atomicWriteJson(statePath, nextState, true);
const rb = verifyJsonReadback(statePath);
if (!rb.ok) die(`state readback failed: ${rb.errors.join("; ")}`);
const readState = validateQueueState(JSON.parse(readFileSync(statePath, "utf8")));
if (!readState.valid || computeStateDigest(readState.state!) !== computeStateDigest(nextState)) die("state digest mismatch after write");

// 6. migration evidence。
const migDir = join(root, "reports/automation/migrations");
mkdirSync(migDir, { recursive: true });
atomicWriteJson(join(migDir, `reconcile-${now.replace(/[:.]/g, "-")}.json`), { ...report, writtenDigest }, true);

// 7. CAS: branch HEAD が read 時から動いていないことを確認（fail-closed）。commit は automation-commit.sh に委譲。
git("fetch", "origin", BRANCH, "--quiet");
const nowSha = git("rev-parse", `origin/${BRANCH}`);
if (nowSha !== baseSha) die(`branch advanced during reconcile (${baseSha.slice(0, 12)} -> ${nowSha.slice(0, 12)}); re-run`);
// automation-commit.sh の CAS 用 base（plain text）。
writeFileSync(join(root, ".automation-branch-base"), baseSha);
console.error(`READY_TO_COMMIT: run 'bash scripts/automation-commit.sh' to push reconciled state to ${BRANCH}`);
process.exit(0);
