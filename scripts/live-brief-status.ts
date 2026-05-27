import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { inspectLiveLog, type LiveLogJob } from "./live-log-utils";

const DB_PATH = "data/boat.sqlite";
const LOG_PATHS: Array<{ path: string; job: LiveLogJob }> = [
  { path: "data/logs/daily-programs.log", job: "daily-programs" },
  { path: "data/logs/daily-programs-err.log", job: "daily-programs" },
  { path: "data/logs/auto-odds.log", job: "auto-odds" },
  { path: "data/logs/auto-odds-err.log", job: "auto-odds" },
  { path: "data/logs/progress.log", job: "daily-progress" },
  { path: "data/logs/progress-err.log", job: "daily-progress" },
];

const now = new Date();
const today = todayJst();
const db = new DatabaseSync(DB_PATH, { readOnly: true });

try {
  const report = buildReport(db);
  printReport(report);
} finally {
  db.close();
}

function buildReport(db: DatabaseSync) {
  const programCount = db.prepare(`
SELECT COUNT(*) AS n
FROM official_programs
WHERE date = ?
`).get(today) as { n: number };

  const oddsCount = db.prepare(`
SELECT COUNT(*) AS n
FROM odds_snapshots
WHERE substr(captured_at, 1, 10) = ?
`).get(today) as { n: number };

  const decisions = db.prepare(`
SELECT decision, COUNT(*) AS n
FROM decision_history
WHERE date = ? AND model_version = ?
GROUP BY decision
`).all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{ decision: string; n: number }>;

  const quality = db.prepare(`
SELECT
  COUNT(*) AS n,
  SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
FROM decision_history
WHERE date >= ? AND model_version = ?
`).get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number; odds_present: number };

  const watchBuyQuality = db.prepare(`
SELECT
  COUNT(*) AS n,
  SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
FROM decision_history
WHERE date >= ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
`).get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number; odds_present: number };

  const liveBuy = db.prepare(`
SELECT COUNT(*) AS n
FROM decision_history
WHERE date >= ? AND model_version = ? AND decision = 'BUY'
`).get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number };

  const logs = LOG_PATHS.map((log) => inspectLiveLog(log.path, log.job));

  return {
    generatedAt: formatJst(now),
    git: gitStatus(),
    guard: guardStatus(),
    programsToday: numberValue(programCount.n),
    oddsToday: numberValue(oddsCount.n),
    decisionsToday: decisionMap(decisions),
    liveBuyN: numberValue(liveBuy.n),
    coverageAll: formatCoverage(numberValue(quality.odds_present), numberValue(quality.n)),
    coverageWatchBuy: formatCoverage(numberValue(watchBuyQuality.odds_present), numberValue(watchBuyQuality.n)),
    errors: logs.filter((log) => !log.ok).map((log) => log.path),
    nextAutoOdds: nextAutoOddsTime(),
    nextProgress: nextDailyTime(21, 5),
  };
}

function printReport(report: ReturnType<typeof buildReport>) {
  const decisions = report.decisionsToday;
  const errorText = report.errors.length === 0 ? "none_new" : report.errors.join(",");
  console.log(`time: ${report.generatedAt}`);
  console.log(`git: ${report.git}`);
  console.log(`guard: ${report.guard}`);
  console.log(`programs: ${today} ${report.programsToday}`);
  console.log(`odds: ${today} ${report.oddsToday}`);
  console.log(`decisions: BUY=${decisions.BUY ?? 0} WATCH=${decisions.WATCH ?? 0} SKIP=${decisions.SKIP ?? 0}`);
  console.log(`live_buy_n: ${report.liveBuyN}/300`);
  console.log(`coverage: all=${report.coverageAll}, watch+buy=${report.coverageWatchBuy}`);
  console.log(`errors: ${errorText}`);
  console.log(`next: auto-odds ${report.nextAutoOdds}, progress ${report.nextProgress}`);
}

function gitStatus() {
  const output = execText("git", ["status", "--short"]);
  return output.trim() === "" ? "clean" : "dirty";
}

function guardStatus() {
  try {
    execFileSync("npm", ["run", "guard:live", "--silent"], { encoding: "utf8", stdio: "pipe" });
    return "ok";
  } catch {
    return "block";
  }
}

function execText(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: "utf8" });
}

function decisionMap(rows: Array<{ decision: string; n: number }>) {
  return Object.fromEntries(rows.map((row) => [row.decision, numberValue(row.n)]));
}

function formatCoverage(present: number, total: number) {
  return total > 0 ? `${present}/${total} ${Math.round((present / total) * 100)}%` : "-";
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function formatJst(date: Date) {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " JST";
}

function nextAutoOddsTime() {
  const current = nowJstParts();
  const minuteSlot = Math.ceil(current.minute / 15) * 15;
  const candidateHour = minuteSlot === 60 ? current.hour + 1 : current.hour;
  const candidateMinute = minuteSlot === 60 ? 0 : minuteSlot;
  if (candidateHour >= 9 && candidateHour <= 21) return `${pad(candidateHour)}:${pad(candidateMinute)}`;
  return nextDailyTime(9, 0);
}

function nextDailyTime(hour: number, minute: number) {
  const current = nowJstParts();
  const isTomorrow = current.hour > hour || (current.hour === hour && current.minute >= minute);
  return `${isTomorrow ? "tomorrow " : ""}${pad(hour)}:${pad(minute)}`;
}

function nowJstParts() {
  const iso = new Date(now.getTime() + 9 * 3600_000).toISOString();
  return {
    hour: Number(iso.slice(11, 13)),
    minute: Number(iso.slice(14, 16)),
  };
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
