import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Severity = "ok" | "warning" | "error";
type Check = { id: string; severity: Severity; message: string; action?: string };
type CountRow = { value: number | bigint | null };
type TextRow = { value: string | null };

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const failOnWarning = args.has("--fail-on-warning");

if (!existsSync(DB_PATH)) {
  const payload = {
    ok: false,
    error: "db_not_found",
    dbPath: DB_PATH,
    nextCommands: ["npm run db:init", "npm run readiness"],
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.error(`DB not found: ${DB_PATH}`);
    console.error("Next commands:");
    for (const command of payload.nextCommands) console.error(`  ${command}`);
  }
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const report = buildReport(db);
  const nextCommands = buildNextCommands(report.checks);
  const reportWithNextCommands = { ...report, nextCommands };
  if (json) console.log(JSON.stringify(reportWithNextCommands, null, 2));
  else printReport(reportWithNextCommands);
  if (!report.ok || (failOnWarning && report.warningCount > 0)) process.exitCode = 1;
} finally {
  db.close();
}

function buildReport(db: DatabaseSync) {
  const checks: Check[] = [];
  const tables = ["race_results", "official_programs", "decision_history", "odds_snapshots", "racer_profiles", "racer_course_stats"];
  for (const table of tables) {
    if (!tableExists(db, table)) {
      checks.push({ id: `table.${table}`, severity: table === "race_results" ? "error" : "warning", message: `${table} table is missing`, action: "Run npm run db:init" });
      continue;
    }
    const n = count(db, `SELECT COUNT(*) AS value FROM ${table}`);
    checks.push({ id: `count.${table}`, severity: n === 0 && table === "race_results" ? "error" : n === 0 ? "warning" : "ok", message: `${table}: ${n} rows`, action: n === 0 ? "Import source data" : undefined });
  }

  freshness(db, checks, "race_results", "date", true);
  freshness(db, checks, "official_programs", "date", false);
  freshness(db, checks, "decision_history", "date", false);

  if (tableExists(db, "racer_profiles")) {
    const n = count(db, "SELECT COUNT(*) AS value FROM racer_profiles");
    checks.push({ id: "coverage.racer_profiles", severity: n >= 500 ? "ok" : "warning", message: `racer profiles: ${n}`, action: n >= 500 ? undefined : "Run npm run fetch:racer-stats" });
  }
  if (tableExists(db, "racer_course_stats")) {
    const racers = count(db, "SELECT COUNT(DISTINCT registration_no) AS value FROM racer_course_stats");
    const full6 = count(db, "SELECT COUNT(*) AS value FROM (SELECT registration_no FROM racer_course_stats GROUP BY registration_no HAVING COUNT(DISTINCT course) >= 6)");
    checks.push({ id: "coverage.course_stats", severity: racers >= 120 ? "ok" : "warning", message: `course stats racers=${racers} full6=${full6}`, action: racers >= 120 ? undefined : "Backfill racer course stats" });
  }

  if (tableExists(db, "decision_history")) {
    const buy = count(db, "SELECT COUNT(*) AS value FROM decision_history WHERE decision='BUY'");
    const watch = count(db, "SELECT COUNT(*) AS value FROM decision_history WHERE decision='WATCH'");
    const skip = count(db, "SELECT COUNT(*) AS value FROM decision_history WHERE decision='SKIP'");
    const buyNoOdds = count(db, "SELECT COUNT(*) AS value FROM decision_history WHERE decision='BUY' AND (current_odds IS NULL OR current_odds <= 0)");
    const buyNoEv = count(db, "SELECT COUNT(*) AS value FROM decision_history WHERE decision='BUY' AND ev IS NULL");
    const duplicate = count(db, "SELECT COUNT(*) AS value FROM (SELECT race_id FROM decision_history WHERE decision IN ('BUY','WATCH') GROUP BY race_id HAVING COUNT(*) > 1)");
    checks.push({ id: "decision.volume", severity: buy + watch + skip >= 100 ? "ok" : "warning", message: `BUY=${buy} WATCH=${watch} SKIP=${skip}`, action: buy + watch + skip >= 100 ? undefined : "Collect more paper-trade history" });
    checks.push({ id: "decision.buy_odds", severity: buyNoOdds === 0 ? "ok" : "warning", message: `BUY rows without odds: ${buyNoOdds}`, action: buyNoOdds === 0 ? undefined : "Require odds before BUY" });
    checks.push({ id: "decision.buy_ev", severity: buyNoEv === 0 ? "ok" : "warning", message: `BUY rows without EV: ${buyNoEv}`, action: buyNoEv === 0 ? undefined : "Persist EV for BUY rows" });
    checks.push({ id: "decision.duplicate", severity: duplicate === 0 ? "ok" : "warning", message: `duplicate BUY/WATCH race ids: ${duplicate}`, action: duplicate === 0 ? undefined : "Normalize duplicate race decisions" });
  }

  const errorCount = checks.filter((c) => c.severity === "error").length;
  const warningCount = checks.filter((c) => c.severity === "warning").length;
  return { generatedAt: new Date().toISOString(), dbPath: DB_PATH, ok: errorCount === 0, errorCount, warningCount, checks };
}

function freshness(db: DatabaseSync, checks: Check[], table: string, column: string, missingIsError: boolean) {
  if (!tableExists(db, table)) return;
  const latest = text(db, `SELECT MAX(${column}) AS value FROM ${table}`)?.slice(0, 10) ?? null;
  if (!latest) {
    checks.push({ id: `freshness.${table}`, severity: missingIsError ? "error" : "warning", message: `${table} latest date is missing`, action: "Check import flow" });
    return;
  }
  const ageDays = daysBetween(latest, todayTokyo());
  checks.push({ id: `freshness.${table}`, severity: ageDays > 45 ? "error" : ageDays > 14 || ageDays < 0 ? "warning" : "ok", message: `${table} latest=${latest} ageDays=${ageDays}`, action: ageDays > 14 || ageDays < 0 ? "Check fetch job, sleep, or LaunchAgent" : undefined });
}

function buildNextCommands(checks: Check[]) {
  const commands = new Set<string>();
  const activeChecks = checks.filter((check) => check.severity !== "ok");

  for (const check of activeChecks) {
    if (check.id.startsWith("table.")) {
      commands.add("npm run db:init");
      commands.add("npm run db:health");
    }

    if (check.id.startsWith("count.")) {
      commands.add("npm run db:health");
      commands.add("npm run list:pending");
    }

    if (check.id.startsWith("freshness.")) {
      commands.add("npm run readiness");
      commands.add("npm run progress");
      commands.add("npm run list:pending");
    }

    if (check.id === "coverage.racer_profiles" || check.id === "coverage.course_stats") {
      commands.add("npm run fetch:racer-stats:dry");
      commands.add("npm run stats:racer-coverage");
    }

    if (check.id === "decision.volume") {
      commands.add("npm run generate:history");
      commands.add("npm run report:weekly");
    }

    if (check.id === "decision.buy_odds") {
      commands.add("npm run decision:dry-run");
      commands.add("npm run live:diagnose");
      commands.add("npm run auto:odds");
    }

    if (check.id === "decision.buy_ev") {
      commands.add("npm run decision:dry-run");
      commands.add("npm run report:weekly");
    }

    if (check.id === "decision.duplicate") {
      commands.add("npm run report:quality");
      commands.add("npm run walk:history");
    }
  }

  if (commands.size === 0) {
    return ["npm run decision:dry-run", "npm run report:weekly"];
  }

  return [...commands];
}

function printReport(report: ReturnType<typeof buildReport> & { nextCommands: string[] }) {
  console.log("Boat Pon data quality");
  console.log(`db=${report.dbPath}`);
  console.log(`status=${report.ok ? "OK" : "ERROR"} warnings=${report.warningCount} errors=${report.errorCount}`);
  for (const check of report.checks) {
    const mark = check.severity === "ok" ? "OK" : check.severity === "warning" ? "WARN" : "ERROR";
    console.log(`${mark}\t${check.id}\t${check.message}`);
    if (check.action) console.log(`  action: ${check.action}`);
  }
  console.log("\nNext commands:");
  for (const command of report.nextCommands) console.log(`  ${command}`);
}

function tableExists(db: DatabaseSync, table: string) {
  return db.prepare("SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name=?").get(table) != null;
}
function count(db: DatabaseSync, sql: string) {
  const row = db.prepare(sql).get() as CountRow | undefined;
  return Number(row?.value ?? 0);
}
function text(db: DatabaseSync, sql: string) {
  const row = db.prepare(sql).get() as TextRow | undefined;
  return row?.value ?? null;
}
function todayTokyo() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function daysBetween(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00+09:00`) - Date.parse(`${from}T00:00:00+09:00`)) / 86_400_000);
}
