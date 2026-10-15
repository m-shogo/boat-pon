/**
 * boat-pon が自動運用できる状態か確認する入口。
 * exit code: 0=正常/警告のみ, 1=致命的エラー
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../server/db";

type Level = "OK" | "WARN" | "ERROR";
const checks: Array<{ level: Level; item: string; detail: string }> = [];

function ok(item: string, detail = "") { checks.push({ level: "OK", item, detail }); }
function warn(item: string, detail = "") { checks.push({ level: "WARN", item, detail }); }
function error(item: string, detail = "") { checks.push({ level: "ERROR", item, detail }); }

function getPackageScripts(): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

const scripts = getPackageScripts();

// --- Node.js ---
ok("node", process.version);

// --- DBファイル ---
const DB_PATH = "data/boat.sqlite";
let db: DatabaseSync | null = null;
try {
  // openDb() は migrate() を実行するため、pull直後や新規環境でも自動でスキーマを最新化する
  db = openDb();
  db.exec("PRAGMA integrity_check");
  ok("db_file", DB_PATH);
} catch (e) {
  error("db_file", `open/migrate failed: ${e}`);
}

// --- ジョブ管理テーブル ---
if (db) {
  for (const table of ["job_runs", "missing_jobs", "job_locks"]) {
    try {
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      ok(`table:${table}`);
    } catch {
      error(`table:${table}`, "not found");
    }
  }
}

// --- package.json scripts（2026-10-15 の最小構成で残した、運用に要るもの） ---
for (const name of ["health", "report:accuracy-scorecard", "notify:line:daily"]) {
  if (name in scripts) ok(`script:${name}`);
  else error(`script:${name}`, "missing from package.json");
}

// --- 既存CLIの存在確認 ---
const cliMap: Record<string, string> = {
  "fetch:official-programs":  "出走表取得",
  "fetch:official-results":   "結果取得",
  "auto:odds":                "オッズ取得",
  "auto:beforeinfo":          "直前情報取得",
  "report:growth":            "成長レポート",
  "audit:data-integrity":     "過去データの監査",
};

for (const [scriptName, label] of Object.entries(cliMap)) {
  if (scriptName in scripts) ok(`cli:${scriptName}`, label);
  else warn(`cli:${scriptName}`, `${label} — 未接続`);
}

// --- DBデータ件数・鮮度 ---
if (db) {
  const tables = [
    { name: "race_results", col: "date" },
    { name: "official_programs", col: "date" },
    { name: "decision_history", col: "date" },
    { name: "odds_snapshots", col: "captured_at" },
    { name: "exhibition_data", col: "fetched_at" },
    { name: "race_weather", col: "fetched_at" },
    { name: "race_equipment", col: "fetched_at" },
  ];
  for (const { name, col } of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as n, MAX(${col}) as latest FROM ${name}`).get() as { n: number; latest: string | null };
      const ageDays = row.latest ? Math.floor((Date.now() - new Date(row.latest).getTime()) / 86400000) : 999;
      const detail = `n=${row.n.toLocaleString()} latest=${row.latest?.slice(0, 10) ?? "none"} (${ageDays}d ago)`;
      if (ageDays > 3) warn(`data:${name}`, detail);
      else ok(`data:${name}`, detail);
    } catch {
      warn(`data:${name}`, "table not found or empty");
    }
  }

  // job_runs 最終成功
  try {
    const row = db.prepare("SELECT job_name, target_date, status FROM job_runs ORDER BY created_at DESC LIMIT 1").get() as { job_name: string; target_date: string; status: string } | undefined;
    if (row) ok("job_runs:latest", `${row.job_name} ${row.target_date} [${row.status}]`);
    else warn("job_runs:latest", "no records yet");
  } catch {
    warn("job_runs:latest", "query failed");
  }

  // failed jobs
  try {
    const row = db.prepare("SELECT COUNT(*) as n FROM job_runs WHERE status='failed'").get() as { n: number };
    if (row.n > 0) warn("job_runs:failed", `${row.n} failed job(s) recorded`);
    else ok("job_runs:failed", "none");
  } catch { /* */ }

  // missing_jobs
  try {
    const row = db.prepare("SELECT COUNT(*) as n FROM missing_jobs").get() as { n: number };
    const level: Level = row.n > 50 ? "WARN" : "OK";
    checks.push({ level, item: "missing_jobs:count", detail: `${row.n} entries` });
  } catch { /* */ }

  db.close();
}

// --- backup script & 状態確認 ---
if ("backup" in scripts) {
  ok("script:backup");
} else {
  warn("script:backup", "missing from package.json");
}

try {
  const { existsSync: fsExists, readdirSync } = await import("node:fs");
  const BACKUP_ROOT = "backups";
  if (!fsExists(BACKUP_ROOT)) {
    warn("backup:dir", "backups/ がまだ存在しない（pnpm backup を実行してください）");
  } else {
    const dirs = readdirSync(BACKUP_ROOT)
      .filter((n: string) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(n))
      .sort();
    const count = dirs.length;
    const latest = dirs[count - 1] ?? null;
    if (count === 0) {
      warn("backup:latest", "バックアップが 0 件（pnpm backup を実行してください）");
    } else {
      const ageMs = latest ? Date.now() - new Date(latest.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3")).getTime() : Infinity;
      const ageDays = Math.floor(ageMs / 86400000);
      const detail = `latest=${latest} (${ageDays}d ago) count=${count}`;
      if (ageDays > 3) warn("backup:latest", detail);
      else ok("backup:latest", detail);
    }
    if (count > 30) warn("backup:count", `${count} 件（30件超過 — 自動削除されるはずです）`);
    else ok("backup:count", `${count} 件`);
  }
} catch (e) {
  warn("backup:check", `確認エラー: ${e}`);
}

// --- launchd: 登録済みのジョブと repo の控え（docs/launchd/）の食い違い・実行するファイルの有無 ---
// 2026-10-15: repo の控えが実際の登録と違っていた（daily-notify）。控えから登録し直すと古い処理に戻るので、ずれを見つける。
const AGENTS_DIR = `${process.env.HOME ?? ""}/Library/LaunchAgents`;
const plistJson = (path: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" })) as Record<string, unknown>;
  } catch {
    return null;
  }
};
if (process.platform === "darwin" && existsSync("docs/launchd")) {
  for (const file of readdirSync("docs/launchd").filter((f) => f.endsWith(".plist"))) {
    const label = file.replace(/\.plist$/, "");
    const installedPath = `${AGENTS_DIR}/${file}`;
    if (!existsSync(installedPath)) {
      warn(`launchd:${label}`, "未登録（docs/launchd に控えだけある）");
      continue;
    }
    const repo = plistJson(`docs/launchd/${file}`);
    const installed = plistJson(installedPath);
    if (!repo || !installed) {
      warn(`launchd:${label}`, "plist を読めない");
      continue;
    }
    const pick = (p: Record<string, unknown>) => JSON.stringify([p.ProgramArguments, p.StartInterval ?? null, p.StartCalendarInterval ?? null, p.WorkingDirectory ?? null]);
    if (pick(repo) !== pick(installed)) warn(`launchd:${label}`, "登録済みの内容と repo の控えが違う（どちらが正しいか確かめて、控えを直す）");
    const args = (installed.ProgramArguments as string[] | undefined) ?? [];
    const cwd = String(installed.WorkingDirectory ?? "");
    const missing = args.filter((a) => /\.(ts|sh|mjs)$/.test(a)).map((a) => (a.startsWith("/") ? a : `${cwd}/${a}`)).filter((a) => !existsSync(a));
    if (missing.length) error(`launchd:${label}`, `実行するファイルが無い: ${missing.join(", ")}`);
    else if (pick(repo) === pick(installed)) ok(`launchd:${label}`);
  }
}

// --- 出力 ---
const icons: Record<Level, string> = { OK: "✓", WARN: "⚠", ERROR: "✗" };
console.log("\n=== boat-pon health-check ===\n");
for (const c of checks) {
  const detail = c.detail ? ` — ${c.detail}` : "";
  console.log(`  ${icons[c.level]} [${c.level}] ${c.item}${detail}`);
}

const errors = checks.filter((c) => c.level === "ERROR");
const warns = checks.filter((c) => c.level === "WARN");
console.log(`\n  summary: ${checks.filter(c=>c.level==="OK").length} OK / ${warns.length} WARN / ${errors.length} ERROR\n`);

if (errors.length > 0) {
  console.error("health-check: FAILED (see ERROR items above)");
  process.exit(1);
} else {
  console.log("health-check: PASSED");
  process.exit(0);
}
