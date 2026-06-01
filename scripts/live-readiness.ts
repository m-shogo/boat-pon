import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { inspectLiveLog, type LiveLogJob } from "./live-log-utils";

const DB_PATH = "data/boat.sqlite";
const AUTO_ODDS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.auto-odds.plist";
const AUTO_EXHIBITION_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.auto-exhibition.plist";
const DAILY_PROGRAMS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.daily-programs.plist";
const DAILY_PROGRESS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.daily-progress.plist";
const DAILY_NOTIFY_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.daily-notify.plist";
const DAILY_RESULTS_PLIST = "/Users/m-shogo/Library/LaunchAgents/com.boatpon.daily-results.plist";
const KNOWN_POLLUTED_SKIP_DATE = "2026-05-26";
const LOG_PATHS: Array<{ path: string; job: LiveLogJob }> = [
  { path: "data/logs/daily-programs.log", job: "daily-programs" },
  { path: "data/logs/daily-programs-err.log", job: "daily-programs" },
  { path: "data/logs/auto-odds.log", job: "auto-odds" },
  { path: "data/logs/auto-odds-err.log", job: "auto-odds" },
  { path: "data/logs/auto-exhibition.log", job: "auto-exhibition" },
  { path: "data/logs/auto-exhibition-err.log", job: "auto-exhibition" },
  { path: "data/logs/progress.log", job: "daily-progress" },
  { path: "data/logs/progress-err.log", job: "daily-progress" },
];

const now = new Date();
const today = todayJst();
const yesterday = addDaysJst(today, -1);
const jsonMode = process.argv.includes("--json");
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const report = buildReport(db);
  if (jsonMode) {
    console.log(JSON.stringify(report));
  } else {
    printReport(report);
  }
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

  const pollutedSkips = db.prepare(`
SELECT COUNT(*) AS n, SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
FROM decision_history
WHERE date = ? AND model_version = ? AND decision = 'SKIP'
`).get(KNOWN_POLLUTED_SKIP_DATE, LIVE_MONITOR_MODEL_VERSION) as { n: number; odds_present: number };

  return {
    today,
    programs,
    decisions,
    odds,
    nextChecks: [
      nextDailyCheck("daily-programs", 8, 0),
      nextAutoOddsCheck(),
      nextIntervalCheck("auto-exhibition", 30),
      nextDailyCheck("daily-progress", 21, 5),
      nextDailyCheck("daily-notify", 21, 30),
      nextDailyCheck("daily-results", 21, 30),
    ],
    pollutedSkips,
    launchAgents: [
      inspectAutoOddsPlist(),
      inspectIntervalPlist("auto-exhibition", AUTO_EXHIBITION_PLIST, 1800),
      inspectSingleTimePlist("daily-programs", DAILY_PROGRAMS_PLIST, 8, 0),
      inspectSingleTimePlist("daily-progress", DAILY_PROGRESS_PLIST, 21, 5),
      inspectSingleTimePlist("daily-notify", DAILY_NOTIFY_PLIST, 21, 30),
      inspectSingleTimePlist("daily-results", DAILY_RESULTS_PLIST, 21, 30),
    ],
    logs: LOG_PATHS.map((log) => inspectLiveLog(log.path, log.job)),
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

  console.log("Next checks:");
  for (const check of report.nextChecks) {
    console.log(`  ${check.name}\t${check.message}`);
  }
  console.log("");

  console.log("Known exclusions:");
  console.log(
    `  ${KNOWN_POLLUTED_SKIP_DATE} SKIP: n=${report.pollutedSkips.n} odds=${report.pollutedSkips.odds_present} ` +
      "旧時刻ズレ期間の汚染SKIPとして監視対象。削除せず、採用判断nには入れない。",
  );
  console.log("");

  console.log("LaunchAgents:");
  for (const agent of report.launchAgents) {
    const mark = agent.ok ? "ok" : "warn";
    console.log(`  ${mark}\t${agent.name}\t${agent.message}`);
  }
  console.log("");

  console.log("Logs:");
  for (const log of report.logs) {
    const mark = !log.exists ? "missing" : log.ok ? "ok" : "warn";
    console.log(`  ${mark}\t${log.path}\t${log.detail}`);
  }
}

function nextDailyCheck(name: string, hour: number, minute: number) {
  const target = nextJstDate(hour, minute);
  return {
    name,
    message: `next ${target} JST`,
  };
}

function nextAutoOddsCheck() {
  const current = nowJstParts();
  const minuteSlot = Math.ceil(current.minute / 15) * 15;
  const candidateHour = minuteSlot === 60 ? current.hour + 1 : current.hour;
  const candidateMinute = minuteSlot === 60 ? 0 : minuteSlot;
  const inWindow = candidateHour >= 9 && candidateHour <= 21;
  const target = inWindow ? nextJstDate(candidateHour, candidateMinute) : nextJstDate(9, 0);
  const suffix = inWindow ? ", then every 15 minutes through 21:45" : "";
  return { name: "auto-odds", message: `next ${target} JST${suffix}` };
}

function nextIntervalCheck(name: string, intervalMinutes: number) {
  const current = nowJstParts();
  const slot = Math.ceil(current.minute / intervalMinutes) * intervalMinutes;
  const hour = slot === 60 ? current.hour + 1 : current.hour;
  const minute = slot === 60 ? 0 : slot;
  const target = hour >= 24 ? nextJstDate(0, minute) : nextJstDate(hour, minute);
  return { name, message: `next around ${target} JST, then every ${intervalMinutes} minutes` };
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

function inspectIntervalPlist(name: string, path: string, expectedSeconds: number) {
  const text = readText(path);
  if (text == null) return { name, ok: false, message: "plist missing" };
  const seconds = Number(text.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  const ok = seconds === expectedSeconds;
  return {
    name,
    ok,
    message: ok ? `every ${Math.round(seconds / 60)} minutes` : `unexpected StartInterval ${Number.isFinite(seconds) ? seconds : "-"}`,
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

function nowJstParts() {
  const iso = new Date(now.getTime() + 9 * 3600_000).toISOString();
  return {
    date: iso.slice(0, 10),
    hour: Number(iso.slice(11, 13)),
    minute: Number(iso.slice(14, 16)),
  };
}

function nextJstDate(hour: number, minute: number) {
  const current = nowJstParts();
  let date = current.date;
  if (current.hour > hour || (current.hour === hour && current.minute >= minute)) {
    date = addDaysJst(date, 1);
  }
  return `${date} ${pad(hour)}:${pad(minute)}`;
}

function addDaysJst(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

function pad(value: number) {
  return Number.isFinite(value) ? String(value).padStart(2, "0") : "--";
}
