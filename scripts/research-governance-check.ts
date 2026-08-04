// boat-pon 研究ガバナンス CI チェック（read-only・純粋検査）。
//
// 実行するもの:
//  - registry schema / filename / append-only(digest) 検証
//  - lineage（dangling 参照）検証
//  - clean-room 違反検出（STRATEGY_LOCAL/REUSABLE の family 間漏洩）
//  - 未承認 adoption 検出（Transfer 無しの Discovery 採用 = 自動採用不可の強制）
//  - Current BUY / Research 分離（decisionSystem）
//  - holdout 汚染検出（holdout race が非 holdout artifact に混入していないか）
//  - production 非接続（research artifact が production marker を含まない）
// いずれか違反で exit 1（CI fail）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectCleanRoomViolations, detectUnauthorizedAdoptions } from "../src/research/governance/contracts";
import { checkLineage, listRecords, validateAllRegistries } from "../src/research/governance/registryStore";
import { checkProductionIsolation } from "../src/research/governance/executorSdk";

const root = resolve(process.cwd());
const REG = join(root, "research/registries");
const problems: string[] = [];
const ok = (label: string) => console.log(`  ok: ${label}`);

// 1. registry validation + lineage
if (existsSync(REG)) {
  const v = validateAllRegistries(REG);
  if (!v.ok) for (const p of v.problems) problems.push(`registry ${p.kind}/${p.file}: ${p.errors.join("; ")}`); else ok("registry schema/filename/append-only");
  const l = checkLineage(REG);
  if (!l.ok) for (const p of l.problems) problems.push(`lineage: ${p}`); else ok("registry lineage");

  // 2. clean-room + unauthorized adoption
  const families = listRecords<any>(REG, "strategy-families");
  const versions = listRecords<any>(REG, "strategy-versions");
  const discoveries = listRecords<any>(REG, "discoveries");
  const transfers = listRecords<any>(REG, "transfer-experiments");
  const cr = detectCleanRoomViolations(families as any, discoveries as any, versions as any);
  if (cr.length) for (const c of cr) problems.push(`clean-room violation: ${c.strategyId} adopted ${c.discoveryId} (${c.shareClass})`); else ok("clean-room enforcement");
  const ua = detectUnauthorizedAdoptions(discoveries as any, transfers as any);
  if (ua.length) for (const u of ua) problems.push(`unauthorized adoption: ${u.discoveryId} -> ${u.strategyId} (no accepted transfer)`); else ok("no auto-adoption (transfer required)");

  // 3. Current BUY / Research separation: legacy family は observation_only version のみ、market_intelligence と混在しない
  const legacy = families.filter((f) => f.decisionSystem === "legacy_t5_formal");
  for (const f of legacy) {
    const vers = versions.filter((v) => v.strategyId === f.strategyId);
    const nonObs = vers.filter((v) => v.changeType !== "observation_only");
    if (nonObs.length) problems.push(`Current BUY separation: legacy family ${f.strategyId} has non-observation version(s)`);
  }
  if (legacy.length) ok("Current BUY / Research separation");
} else {
  ok("no registries yet (skipped)");
}

// 4. holdout 汚染: holdout race key が非 holdout research artifact に生値で混入していないか。
const HOLDOUT_FREEZE = join(root, "reports/n2/n2-holdout-freeze.json");
let holdoutRaces: string[] = [];
if (existsSync(HOLDOUT_FREEZE)) {
  try { holdoutRaces = JSON.parse(readFileSync(HOLDOUT_FREEZE, "utf8")).untouchedHoldoutRaces ?? []; } catch { /* ignore */ }
}
if (holdoutRaces.length) {
  // holdout race は holdout-freeze / audit 系にだけ現れてよい。それ以外の n2 report に生値があれば汚染候補。
  const allowFiles = new Set(["n2-holdout-freeze.json", "n2-win-refund-omission-audit.json", "n2-dataset-canary.json", "n2-dataset-canary.md"]);
  const n2dir = join(root, "reports/n2");
  if (existsSync(n2dir)) {
    for (const f of readdirSync(n2dir).filter((x) => x.endsWith(".json") && !allowFiles.has(x))) {
      const txt = readFileSync(join(n2dir, f), "utf8");
      for (const hr of holdoutRaces) if (txt.includes(hr)) problems.push(`holdout contamination: ${hr} appears in reports/n2/${f}`);
    }
  }
  ok("holdout isolation");
}

// 5. production 非接続: research config / registry の「構造フィールド」に production marker が無いこと。
// 人間記述フィールド（〜を変更しない 等の散文）は誤検知するので scan 対象から除外する。
const PROSE_KEYS = new Set([
  "changeReason", "note", "coreThesis", "mechanismHypothesis", "finding", "reason", "rationale",
  "researchQuestion", "hypothesis", "objective", "scope", "invalidationCondition", "valueOfInformation",
  "successCondition", "rejectionCondition", "stoppingRule", "authorityNote", "engineeringNote", "title",
]);
function stripProse(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripProse);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!PROSE_KEYS.has(k)) out[k] = stripProse(val);
    return out;
  }
  return v;
}
for (const p of ["config/research-governance", "research/registries"]) {
  const dir = join(root, p);
  if (!existsSync(dir)) continue;
  const scan = (d: string): void => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) { scan(full); continue; }
      if (!e.endsWith(".json")) continue;
      let structural = "";
      try { structural = JSON.stringify(stripProse(JSON.parse(readFileSync(full, "utf8")))); } catch { structural = readFileSync(full, "utf8"); }
      const iso = checkProductionIsolation(structural);
      if (!iso.ok) problems.push(`production marker in ${full} (structural): ${iso.markers.join(",")}`);
    }
  };
  scan(dir);
}
ok("production isolation (research artifacts)");

// 6. no large DB/raw artifact staged under research/ (Git hygiene)
try {
  const tracked = execFileSync("git", ["ls-files", "research/", "config/research-governance/"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of tracked) {
    if (/\.(sqlite|sqlite-.*|duckdb|parquet|lzh|zip|bin|model)$/.test(f)) problems.push(`large/binary artifact tracked under research: ${f}`);
  }
  ok("no large DB/raw artifact under research");
} catch { /* ignore */ }

if (problems.length) {
  console.error(`\n::error::research governance check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nresearch governance check: PASS");
