/**
 * decision audit 周りの導入状態を確認する読み取り専用チェック。
 *
 * 見ること:
 * - DBが存在するか
 * - decision_history に audit 用カラムがあるか
 * - odds_timeseries_snapshots があるか
 * - 追加CLIファイルがあるか
 * - package.json に script が登録されているか
 */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

const checks: Check[] = [];

checkFiles();
checkPackageScripts();
if (!args.noDb) checkDb();

const ok = checks.every((check) => check.ok);

if (args.json) {
  console.log(JSON.stringify({ ok, generatedAt: new Date().toISOString(), checks, noDb: args.noDb, soft: args.soft }, null, 2));
} else {
  printChecks();
}

if (!ok && !args.soft) process.exitCode = 1;

type Check = {
  ok: boolean;
  area: string;
  name: string;
  message: string;
  action?: string;
};

function add(ok: boolean, area: string, name: string, message: string, action?: string) {
  checks.push({ ok, area, name, message, action });
}

function checkFiles() {
  const files = [
    "scripts/migrate-decision-audit.ts",
    "scripts/report-decision-reasons.ts",
    "scripts/report-clv.ts",
    "scripts/report-feature-breakdown.ts",
    "src/domain/programFeatures.breakdown.test.ts",
    "docs/decision-audit-roadmap.md",
  ];

  for (const file of files) {
    add(existsSync(file), "file", file, existsSync(file) ? "exists" : "missing", `git pull or restore ${file}`);
  }
}

function checkPackageScripts() {
  const path = "package.json";
  if (!existsSync(path)) {
    add(false, "package", path, "package.json missing");
    return;
  }

  const pkg = JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const required = [
    "migrate:decision-audit",
    "report:decision-reasons",
    "report:clv",
    "report:feature-breakdown",
    "typecheck:scripts",
  ];

  for (const name of required) {
    add(Boolean(scripts[name]), "package-script", name, scripts[name] ? scripts[name] : "missing", `add scripts.${name}`);
  }
}

function checkDb() {
  if (!existsSync(DB_PATH)) {
    add(false, "db", DB_PATH, "DB not found", "pnpm db:init or confirm BOAT_PON_DB_PATH");
    return;
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    add(tableExists(db, "decision_history"), "db-table", "decision_history", tableExists(db, "decision_history") ? "exists" : "missing");
    add(tableExists(db, "odds_timeseries_snapshots"), "db-table", "odds_timeseries_snapshots", tableExists(db, "odds_timeseries_snapshots") ? "exists" : "missing");

    const requiredColumns = [
      "decision_reasons",
      "feature_adjustment",
      "feature_adjustment_breakdown",
    ];
    for (const column of requiredColumns) {
      const ok = columnExists(db, "decision_history", column);
      add(ok, "db-column", `decision_history.${column}`, ok ? "exists" : "missing", "pnpm migrate:decision-audit");
    }
  } finally {
    db.close();
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) != null;
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function printChecks() {
  console.log("=== decision audit doctor ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`db: ${DB_PATH}`);
  console.log("");

  for (const check of checks) {
    const mark = check.ok ? "✅" : "❌";
    console.log(`${mark} [${check.area}] ${check.name}: ${check.message}`);
    if (!check.ok && check.action) console.log(`   action: ${check.action}`);
  }

  console.log("");
  console.log(checks.every((check) => check.ok) ? "OK: decision audit is ready" : "NG: follow actions above");
}

function parseArgs(argv: string[]) {
  const parsed = { json: false, noDb: false, soft: false };
  for (const arg of argv) {
    if (arg === "--json") parsed.json = true;
    else if (arg === "--no-db") parsed.noDb = true;
    else if (arg === "--soft") parsed.soft = true;
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  pnpm audit:doctor [--json] [--no-db] [--soft]

Read-only. Checks decision audit setup.

  --no-db  skip DB checks (for fresh clone / CI environments without a local DB)
  --soft   always exit 0, even if checks fail (warn only)`);
}
