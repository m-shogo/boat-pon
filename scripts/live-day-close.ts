import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { inspectLiveLog } from "./live-log-utils";

const DB_PATH = "data/boat.sqlite";
const CLOSE_HOUR = 21;
const CLOSE_MINUTE = 5;

const now = new Date();
const today = todayJst();
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  run();
} finally {
  db.close();
}

function run() {
  const programCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM official_programs WHERE date = ?`).get(today) as { n: number }
  ).n;

  const oddsCount = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM odds_snapshots WHERE substr(captured_at, 1, 10) = ?`)
      .get(today) as { n: number }
  ).n;

  const decisionRows = db
    .prepare(
      `SELECT decision, COUNT(*) AS n FROM decision_history WHERE date = ? AND model_version = ? GROUP BY decision`,
    )
    .all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{ decision: string; n: number }>;
  const dec = Object.fromEntries(decisionRows.map((r) => [r.decision, r.n]));

  const liveBuyN = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM decision_history WHERE date >= ? AND model_version = ? AND decision = 'BUY'`,
      )
      .get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number }
  ).n;

  const watchBuyQ = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
       FROM decision_history WHERE date >= ? AND model_version = ? AND decision IN ('WATCH', 'BUY')`,
    )
    .get(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as { n: number; odds_present: number };

  const progressLog = inspectLiveLog("data/logs/progress.log", "daily-progress");
  const progressErrLog = inspectLiveLog("data/logs/progress-err.log", "daily-progress");

  const afterClose = isPastCloseTime();
  const closeStatus = resolveCloseStatus(afterClose, progressLog, progressErrLog);

  const coverage =
    watchBuyQ.n > 0
      ? `${watchBuyQ.odds_present}/${watchBuyQ.n} ${Math.round((watchBuyQ.odds_present / watchBuyQ.n) * 100)}%`
      : "-";

  console.log(`date: ${today}`);
  console.log(`programs: ${programCount}`);
  console.log(`odds_snapshots: ${oddsCount}`);
  console.log(`decisions: BUY=${dec.BUY ?? 0} WATCH=${dec.WATCH ?? 0} SKIP=${dec.SKIP ?? 0}`);
  console.log(`live_buy_n: ${liveBuyN}/300`);
  console.log(`watch+buy odds coverage: ${coverage}`);
  console.log(`progress.log: ${progressLog.detail}`);
  console.log(`progress-err.log: ${progressErrLog.detail}`);
  console.log(`close_status: ${closeStatus}`);
  console.log(`action: ${resolveAction(closeStatus)}`);
}

function isPastCloseTime() {
  const iso = new Date(now.getTime() + 9 * 3600_000).toISOString();
  const hour = Number(iso.slice(11, 13));
  const minute = Number(iso.slice(14, 16));
  return hour > CLOSE_HOUR || (hour === CLOSE_HOUR && minute >= CLOSE_MINUTE);
}

function resolveCloseStatus(
  afterClose: boolean,
  progressLog: ReturnType<typeof inspectLiveLog>,
  progressErrLog: ReturnType<typeof inspectLiveLog>,
) {
  if (!afterClose) return "waiting";
  if (!progressLog.exists || !progressErrLog.ok) return "warn";
  return "ok";
}

function resolveAction(closeStatus: string) {
  if (closeStatus === "waiting") return "wait until 21:05";
  if (closeStatus === "warn") return "review progress log";
  return "wait for data";
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
