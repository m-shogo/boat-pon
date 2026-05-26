import { existsSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

const DB_PATH = "data/boat.sqlite";
const AUTO_ODDS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.auto-odds.plist";
const DAILY_PROGRAMS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.daily-programs.plist";
const DAILY_PROGRESS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.daily-progress.plist";
const LOG_PATHS = [
  "data/logs/daily-programs.log",
  "data/logs/daily-programs-err.log",
  "data/logs/auto-odds.log",
  "data/logs/auto-odds-err.log",
  "data/logs/progress.log",
  "data/logs/progress-err.log",
];

const today = todayJst();
const yesterday = addDaysJst(today, -1);
const db = new DatabaseSync(DB_PATH, { readOnly: true });

try {
  const report = buildReport(db);
  printReport(report);
} finally {
  db.close();
}

function buildReport(db: DatabaseSync) {
  const programs = db.prepare(`
SELECT date, COUNT(*) AS n
FROM official_programs
WHERE date >= ?
GROUP BY date
ORDER BY date
`).all(yesterday) as Array<{ date: string; n: number }>;

  const decisions = db.prepare(`
SELECT date, decision, COUNT(*) AS n, SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
FROM decision_history
WHERE date >= ? AND model_version = ?
GROUP BY date, decision
ORDER BY date, decision
`).all(yesterday, LIVE_MONITOR_MODEL_VERSION) as Array<{ date: string; decision: string; n: number; odds_present: number }>;

  const odds = db.prepare(`
SELECT substr(captured_at, 1, 10) AS date, COUNT(*) AS n
FROM odds_snapshots
WHERE substr(captured_at, 1, 10) >= ?
GROUP BY 1
ORDER BY 1
`).all(yesterday) as Array<{ date: string; n: number }>;

  return {
    today,
    programs,
    decisions,
    odds,
    launchAgents: [
      inspectAutoOddsPlist(),
      inspectSingleTimePlist("daily-programs", DAILY_PROGRAMS_PLIST, 8, 0),
      inspectSingleTimePlist("daily-progress", DAILY_PROGRESS_PLIST, 21, 5),
    ],
    logs: LOG_PATHS.map(inspectLog),
  };
}

function printReport(report: ReturnType<typeof buildReport>) {
  console.log("=== Boat Pon live readiness ===");
  console.log(`today(JST): ${report.today}`);
  console.log("");

  console.log("DB freshness:");
  printRows("programs", report.programs.map((row) => `${row.date}: ${row.n}`));
  printRows("decisions", report.decisions.map((row) => `${row.date} ${row.decision}: n=${row.n} odds=${row.odds_present}`));
  printRows("odds snapshots", report.odds.map((row) => `${row.date}: ${row.n}`));
  console.log("");

  console.log("LaunchAgents:");
  for (const agent of report.launchAgents) {
    const mark = agent.ok ? "ok" : "warn";
    console.log(`  ${mark}\t${agent.name}\t${agent.message}`);
  }
  console.log("");

  console.log("Logs:");
  for (const log of report.logs) {
    const mark = log.exists ? "ok" : "missing";
    console.log(`  ${mark}\t${log.path}\t${log.detail}`);
  }
}

function inspectAutoOddsPlist() {
  const text = readText(AUTO_ODDS_PLIST);
  if (text == null) return { name: "auto-odds", ok: false, message: "plist missing" };
  const hours = [...text.matchAll(/<key>Hour<\/key><integer>(\d+)<\/integer>/g)].map((match) => Number(match[1]));
  const min = Math.min(...hours);
  const max = Math.max(...hours);
  const hasOldUtcShape = min === 0 && max === 12;
  const hasExpectedShape = min === 9 && max === 21;
  return {
    name: "auto-odds",
    ok: hasExpectedShape && !hasOldUtcShape,
    message: hasExpectedShape
      ? "9:00-21:00 JST local-time schedule"
      : `unexpected hour range ${Number.isFinite(min) ? min : "-"}-${Number.isFinite(max) ? max : "-"}`,
  };
}

function inspectSingleTimePlist(name: string, path: string, expectedHour: number, expectedMinute: number) {
  const text = readText(path);
  if (text == null) return { name, ok: false, message: "plist missing" };
  const hour = Number(text.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  const minute = Number(text.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  const ok = hour === expectedHour && minute === expectedMinute;
  return {
    name,
    ok,
    message: ok ? `${pad(hour)}:${pad(minute)} JST local-time schedule` : `unexpected time ${pad(hour)}:${pad(minute)}`,
  };
}

function inspectLog(path: string) {
  if (!existsSync(path)) return { path, exists: false, detail: "not created yet" };
  const stat = statSync(path);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n").filter(Boolean);
  return {
    path,
    exists: true,
    detail: `${stat.size} bytes, lines=${lines.length}, last=${lines.at(-1) ?? "-"}`,
  };
}

function readText(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function printRows(label: string, rows: string[]) {
  console.log(`  ${label}:`);
  if (rows.length === 0) {
    console.log("    none");
    return;
  }
  for (const row of rows) console.log(`    ${row}`);
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDaysJst(date: string, days: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pad(value: number) {
  return Number.isFinite(value) ? String(value).padStart(2, "0") : "--";
}
