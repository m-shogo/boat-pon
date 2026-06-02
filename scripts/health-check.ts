/**
 * boat-pon が自動運用できる状態か確認する入口。
 * exit code: 0=正常/警告のみ, 1=致命的エラー
 */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

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
if (!existsSync(DB_PATH)) {
  error("db_file", `${DB_PATH} not found`);
} else {
  try {
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA integrity_check");
    ok("db_file", DB_PATH);
  } catch (e) {
    error("db_file", `open failed: ${e}`);
  }
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

// --- package.json scripts ---
for (const name of ["catchup", "daily", "health"]) {
  if (name in scripts) ok(`script:${name}`);
  else error(`script:${name}`, "missing from package.json");
}

// --- 既存CLIの存在確認 ---
const cliMap: Record<string, string> = {
  "fetch:official-programs":  "出走表取得",
  "fetch:official-results":   "結果取得",
  "auto:odds":                "オッズ取得",
  "auto:beforeinfo":          "直前情報取得",
  "backfill:beforeinfo":      "直前情報バックフィル",
  "backfill:motor-boat-stats":"モーター/ボート成績バックフィル",
  "report:daily":             "日次レポート",
  "report:weekly":            "週次レポート",
  "report:data-coverage":     "データカバレッジ確認",
  "status:brief":             "簡易ステータス",
  "validate:data":            "データ整合性チェック",
  "decision:dry-run":         "期待値判定dry-run",
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
