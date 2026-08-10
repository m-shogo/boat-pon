// boat-pon 研究ガバナンス CI チェック（read-only・fail-closed）。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isExecutorImplemented } from "../src/automation/taskExecutors";
import { detectCleanRoomViolations, detectUnauthorizedAdoptions } from "../src/research/governance/contracts";
import { checkLineage, listRecords, validateAllRegistries } from "../src/research/governance/registryStore";
import { checkProductionIsolation } from "../src/research/governance/executorSdk";
import {
  assertGovernanceDirectorySafe,
  listJsonFilesFailClosed,
  readGovernanceFileUtf8,
} from "../src/research/governance/safeFs";

const root = resolve(process.cwd());
const REG = join(root, "research/registries");
const problems: string[] = [];
const ok = (label: string) => console.log(`  ok: ${label}`);

if (existsSync(REG)) {
  const v = validateAllRegistries(REG);
  if (!v.ok) for (const p of v.problems) problems.push(`registry ${p.kind}/${p.file}: ${p.errors.join("; ")}`); else ok("registry schema/filename/digest");
  const l = checkLineage(REG);
  if (!l.ok) for (const p of l.problems) problems.push(`lineage: ${p}`); else ok("registry lineage");

  const families = listRecords<any>(REG, "strategy-families");
  const versions = listRecords<any>(REG, "strategy-versions");
  const discoveries = listRecords<any>(REG, "discoveries");
  const transfers = listRecords<any>(REG, "transfer-experiments");
  const cr = detectCleanRoomViolations(families, discoveries, versions);
  if (cr.length) for (const c of cr) problems.push(`clean-room violation: ${c.strategyId} adopted ${c.discoveryId} (${c.shareClass})`); else ok("clean-room enforcement");
  const ua = detectUnauthorizedAdoptions(discoveries, transfers);
  if (ua.length) for (const u of ua) problems.push(`unauthorized adoption: ${u.discoveryId} -> ${u.strategyId}`); else ok("transfer required before adoption");

  const legacy = families.filter((f) => f.decisionSystem === "legacy_t5_formal");
  for (const family of legacy) {
    const nonObservation = versions.filter((v) => v.strategyId === family.strategyId && v.changeType !== "observation_only");
    if (nonObservation.length) problems.push(`Current BUY separation: ${family.strategyId} has non-observation version`);
  }
  if (legacy.length) ok("Current BUY / Research separation");
} else {
  problems.push("research registry root missing");
}

// Catalog readiness must agree with the static executor allowlist.
const catalogPath = join(root, "automation/task-catalog.json");
const mappingPath = join(root, "automation/phase-mapping.json");
if (!existsSync(catalogPath)) {
  problems.push("automation/task-catalog.json missing");
} else {
  const catalog = JSON.parse(readGovernanceFileUtf8(catalogPath)) as { tasks?: Array<Record<string, any>> };
  const tasks = catalog.tasks ?? [];
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.taskId)) problems.push(`duplicate taskId: ${task.taskId}`);
    ids.add(task.taskId);
    const implemented = isExecutorImplemented(String(task.executor ?? task.taskType));
    if (task.defaultStatus === "READY" && !implemented) {
      problems.push(`catalog readiness mismatch: ${task.taskId} READY but executor ${task.executor} is not implemented`);
    }
    if (task.defaultStatus === "BLOCKED_EXECUTOR_PENDING" && implemented) {
      problems.push(`catalog readiness mismatch: ${task.taskId} blocked but executor ${task.executor} is implemented`);
    }
  }
  const expand = tasks.find((t) => t.taskId === "TASK-N2-010");
  if (!expand || expand.defaultStatus !== "READY" || expand.taskDefinitionVersion !== 2) {
    problems.push("TASK-N2-010 must be definition v2 and READY");
  }
  ok("task catalog / executor readiness");

  if (existsSync(mappingPath)) {
    const mapping = JSON.parse(readGovernanceFileUtf8(mappingPath)) as { legacyTaskAliases?: Array<Record<string, any>> };
    const mapped = new Map((mapping.legacyTaskAliases ?? []).map((x) => [x.legacy, x]));
    for (const task of tasks.filter((t) => /^TASK-(N2|N3|N4|N5|N6|N7|N8|D2|E1|E2)-/.test(String(t.taskId)))) {
      if (!mapped.has(task.taskId)) problems.push(`phase mapping missing task: ${task.taskId}`);
    }
    const expandMapping = mapped.get("TASK-N2-010");
    if (!expandMapping || expandMapping.status !== "implemented_ready") problems.push("TASK-N2-010 phase mapping must be implemented_ready");
    ok("task catalog / phase mapping");
  } else {
    problems.push("automation/phase-mapping.json missing");
  }
}

// Untouched holdout race keys may only appear in explicit freeze/audit authorities.
// These legacy settlement-reparse artifacts predate n2-holdout-freeze.json and are
// immutable evidence that explicitly documents the same two quarantined races.
// Keep the allowlist exact: every other N2 JSON remains fail-closed.
const HOLDOUT_FREEZE = join(root, "reports/n2/n2-holdout-freeze.json");
let holdoutRaces: string[] = [];
if (existsSync(HOLDOUT_FREEZE)) {
  try { holdoutRaces = JSON.parse(readGovernanceFileUtf8(HOLDOUT_FREEZE)).untouchedHoldoutRaces ?? []; }
  catch { problems.push("holdout freeze is not valid JSON or is not a safe regular file"); }
}
if (holdoutRaces.length) {
  const allowFiles = new Set([
    "n2-holdout-freeze.json",
    "n2-win-refund-omission-audit.json",
    "n2-dataset-canary.json",
    "n2-dataset-canary.md",
    "corrected-settlement-truth-freeze.json",
    "settlement-reparse-apply-manifest.json",
    "settlement-reparse-approval-grant.json",
    "settlement-reparse-approval-manifest.json",
    "settlement-reparse-examples.json",
    "unexpected-additions-audit.json",
  ]);
  const n2dir = join(root, "reports/n2");
  if (existsSync(n2dir)) {
    try {
      assertGovernanceDirectorySafe(n2dir);
      for (const file of readdirSync(n2dir).filter((x) => x.endsWith(".json") && !allowFiles.has(x))) {
        const text = readGovernanceFileUtf8(join(n2dir, file));
        for (const race of holdoutRaces) if (text.includes(race)) problems.push(`holdout contamination: ${race} in reports/n2/${file}`);
      }
    } catch (error) {
      problems.push(`holdout audit filesystem check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  ok("holdout raw-key isolation");
}

const PROSE_KEYS = new Set([
  "changeReason", "note", "coreThesis", "mechanismHypothesis", "finding", "reason", "rationale",
  "researchQuestion", "hypothesis", "objective", "scope", "invalidationCondition", "valueOfInformation",
  "successCondition", "rejectionCondition", "stoppingRule", "authorityNote", "engineeringNote", "title",
]);
function stripProse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProse);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) if (!PROSE_KEYS.has(key)) output[key] = stripProse(child);
    return output;
  }
  return value;
}
for (const relative of ["config/research-governance", "research/registries"]) {
  const dir = join(root, relative);
  if (!existsSync(dir)) continue;
  try {
    for (const full of listJsonFilesFailClosed(dir)) {
      const text = readGovernanceFileUtf8(full);
      let structural: string;
      try { structural = JSON.stringify(stripProse(JSON.parse(text))); }
      catch { structural = text; }
      const isolation = checkProductionIsolation(structural);
      if (!isolation.ok) problems.push(`production marker in ${full}: ${isolation.markers.join(",")}`);
    }
  } catch (error) {
    problems.push(`production isolation scan failed (${relative}): ${error instanceof Error ? error.message : String(error)}`);
  }
}
ok("production isolation");

try {
  const tracked = execFileSync("git", ["ls-files", "research/", "config/research-governance/"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const file of tracked) if (/\.(sqlite|sqlite-.*|duckdb|parquet|lzh|zip|bin|model)$/.test(file)) problems.push(`large/binary artifact tracked: ${file}`);
  ok("no large research artifact in Git");
} catch (error) {
  problems.push(`git artifact audit failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (problems.length) {
  console.error(`\n::error::research governance check failed (${problems.length})`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nresearch governance check: PASS");
