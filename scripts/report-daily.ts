import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

type Severity = "ok" | "warning" | "error";
type CountRow = { value: number | bigint | null };
type TextRow = { value: string | null };
type DailyAlert = { severity: Severity; code: string; message: string; action?: string };

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  const alerts: DailyAlert[] = [{ severity: "error", code: "db_not_found", message: `DB not found: ${DB_PATH}`, action: "npm run db:init" }];
  const payload = {
    generatedAt: new Date().toISOString(),
    date: args.date,
    dbPath: DB_PATH,
    ok: false,
    alerts,
    nextCommands: ["npm run db:init", "npm run readiness"],
  };
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printMissingDb(payload);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const report = buildReport(db, args.date);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (!report.ok) process.exitCode = 1;
} finally {
  db.close();
}

function parseArgs(argv: string[]) {
  const parsed = { date: todayTokyo(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--date") parsed.date = argv[++i] ?? parsed.date;
    else if (arg.startsWith("--date=")) parsed.date = arg.slice("--date=".length);
  }
  return parsed;
}

function buildReport(db: DatabaseSync, date: string) {
  const freshness = {
    raceResults: latestInfo(db, "race_results", "date"),
    officialPrograms: latestInfo(db, "official_programs", "date"),
    decisionHistory: latestInfo(db, "decision_history", "date"),
    oddsSnapshots: latestInfo(db, "odds_snapshots", "captured_at"),
    racerProfiles: latestInfo(db, "racer_profiles", "fetched_at"),
    racerCourseStats: latestInfo(db, "racer_course_stats", "fetched_at"),
  };

  const today = {
    programs: tableExists(db, "official_programs") ? count(db, "SELECT COUNT(*) AS value FROM official_programs WHERE date = ?", date) : 0,
    oddsSnapshots: tableExists(db, "odds_snapshots") ? count(db, "SELECT COUNT(*) AS value FROM odds_snapshots WHERE substr(captured_at, 1, 10) = ?", date) : 0,
    oddsRaces: tableExists(db, "odds_snapshots") ? count(db, "SELECT COUNT(DISTINCT race_id) AS value FROM odds_snapshots WHERE substr(captured_at, 1, 10) = ?", date) : 0,
    decisions: tableExists(db, "decision_history") ? decisionCounts(db, date) : { BUY: 0, WATCH: 0, SKIP: 0, total: 0 },
  };

  const racerCoverage = buildRacerCoverage(db, date);
  const beforeInfoCoverage = buildBeforeInfoCoverage(db, date);
  const logDiagnostics = buildLogDiagnostics(date);
  const dataCoverage = buildDataCoverage(db);
  const alerts = buildAlerts(date, freshness, today, racerCoverage, beforeInfoCoverage, dataCoverage, logDiagnostics);
  const nextCommands = buildNextCommands(alerts);
  const errorCount = alerts.filter((a) => a.severity === "error").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return {
    generatedAt: new Date().toISOString(),
    date,
    dbPath: DB_PATH,
    modelVersion: LIVE_MONITOR_MODEL_VERSION,
    ok: errorCount === 0,
    warningCount,
    errorCount,
    freshness,
    today,
    racerCoverage,
    beforeInfoCoverage,
    logDiagnostics,
    dataCoverage,
    alerts,
    nextCommands,
    safety: {
      readOnly: true,
      autoBetting: false,
      autoRuleAdoption: false,
      note: "診断のみ。live設定変更、DB書き込み、自動投票は行わない。",
    },
  };
}

function buildBeforeInfoCoverage(db: DatabaseSync, date: string) {
  const empty = {
    totalRaces: 0,
    exhibitionRaces: 0,
    weatherRaces: 0,
    equipmentRaces: 0,
    fullRaces: 0,
    exhibitionPct: null as number | null,
    weatherPct: null as number | null,
    equipmentPct: null as number | null,
    fullPct: null as number | null,
    watchBuyRaces: 0,
    watchBuyFullRaces: 0,
    watchBuyFullPct: null as number | null,
  };
  if (!tableExists(db, "official_programs")) return empty;

  const totalRaces = count(db, "SELECT COUNT(*) AS value FROM official_programs WHERE date = ?", date);
  if (totalRaces === 0) return empty;
  const exhibitionRaces = tableExists(db, "exhibition_data") ? count(db, `
    SELECT COUNT(DISTINCT e.race_id) AS value
    FROM exhibition_data e
    JOIN official_programs p ON p.race_id = e.race_id
    WHERE p.date = ?
  `, date) : 0;
  const weatherRaces = tableExists(db, "race_weather") ? count(db, `
    SELECT COUNT(DISTINCT w.race_id) AS value
    FROM race_weather w
    JOIN official_programs p ON p.race_id = w.race_id
    WHERE p.date = ?
  `, date) : 0;
  const equipmentRaces = tableExists(db, "race_equipment") ? count(db, `
    SELECT COUNT(DISTINCT q.race_id) AS value
    FROM race_equipment q
    JOIN official_programs p ON p.race_id = q.race_id
    WHERE p.date = ?
  `, date) : 0;
  const fullRaces = count(db, `
    SELECT COUNT(*) AS value
    FROM official_programs p
    WHERE p.date = ?
      AND EXISTS (SELECT 1 FROM exhibition_data e WHERE e.race_id = p.race_id)
      AND EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = p.race_id)
      AND EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = p.race_id)
  `, date);
  const watchBuyRaces = tableExists(db, "decision_history") ? count(db, `
    SELECT COUNT(DISTINCT race_id) AS value
    FROM decision_history
    WHERE date = ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
  `, date, LIVE_MONITOR_MODEL_VERSION) : 0;
  const watchBuyFullRaces = watchBuyRaces > 0 ? count(db, `
    SELECT COUNT(DISTINCT dh.race_id) AS value
    FROM decision_history dh
    WHERE dh.date = ? AND dh.model_version = ? AND dh.decision IN ('WATCH', 'BUY')
      AND EXISTS (SELECT 1 FROM exhibition_data e WHERE e.race_id = dh.race_id)
      AND EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = dh.race_id)
      AND EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = dh.race_id)
  `, date, LIVE_MONITOR_MODEL_VERSION) : 0;

  return {
    totalRaces,
    exhibitionRaces,
    weatherRaces,
    equipmentRaces,
    fullRaces,
    exhibitionPct: pctNumber(exhibitionRaces, totalRaces),
    weatherPct: pctNumber(weatherRaces, totalRaces),
    equipmentPct: pctNumber(equipmentRaces, totalRaces),
    fullPct: pctNumber(fullRaces, totalRaces),
    watchBuyRaces,
    watchBuyFullRaces,
    watchBuyFullPct: pctNumber(watchBuyFullRaces, watchBuyRaces),
  };
}

function buildLogDiagnostics(date: string) {
  const errPath = "data/logs/auto-exhibition-err.log";
  const outPath = "data/logs/auto-exhibition.log";
  return {
    autoExhibition: {
      errorLog: summarizeLog(errPath, date, true),
      runLog: summarizeLog(outPath, date, false),
    },
  };
}

function summarizeLog(path: string, date: string, errorOnly: boolean) {
  const normalizedDate = date.replaceAll("-", "");
  if (!existsSync(path)) return { path, exists: false, total: 0, activeTotal: 0, legacyTotal: 0, byKind: {}, latest: null as string | null };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.includes(normalizedDate));
  const selected = errorOnly ? lines.filter((line) => /error|failed|HTTP|usage/i.test(line)) : lines;
  const byKind: Record<string, number> = {};
  let activeTotal = 0;
  let legacyTotal = 0;
  for (const line of selected) {
    const kind = classifyLogLine(line);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (kind.startsWith("legacy_")) legacyTotal += 1;
    else activeTotal += 1;
  }
  return { path, exists: true, total: selected.length, activeTotal, legacyTotal, byKind, latest: selected.at(-1) ?? null };
}

function classifyLogLine(line: string) {
  const isTimestamped = /^\[\d{4}-\d{2}-\d{2}T/.test(line);
  if (!isTimestamped && /exhibition-error:/.test(line)) return "legacy_fetch_failed";
  if (!isTimestamped && /usage:/.test(line)) return "legacy_usage";
  if (/beforeinfo-empty|exhibition-empty/.test(line)) return "empty";
  if (/HTTP\s+404|404/.test(line)) return "http_404";
  if (/HTTP\s+403|403/.test(line)) return "http_403";
  if (/fetch failed/i.test(line)) return "fetch_failed";
  if (/usage:/.test(line)) return "usage";
  if (/beforeinfo-error|exhibition-error/.test(line)) return "fetch_error";
  if (/beforeinfo:|exhibition:/.test(line)) return "fetched";
  if (/tooEarly/.test(line)) return "too_early";
  if (/tooLate/.test(line)) return "too_late";
  return "other";
}

function decisionCounts(db: DatabaseSync, date: string) {
  const rows = db.prepare(`
    SELECT decision, COUNT(*) AS n
    FROM decision_history
    WHERE date = ? AND model_version = ?
    GROUP BY decision
  `).all(date, LIVE_MONITOR_MODEL_VERSION) as Array<{ decision: "BUY" | "WATCH" | "SKIP"; n: number }>;
  const counts = { BUY: 0, WATCH: 0, SKIP: 0, total: 0 };
  for (const row of rows) {
    if (row.decision === "BUY" || row.decision === "WATCH" || row.decision === "SKIP") {
      counts[row.decision] = Number(row.n);
      counts.total += Number(row.n);
    }
  }
  return counts;
}

function buildRacerCoverage(db: DatabaseSync, date: string) {
  const empty = { total: 0, courseStats: 0, profiles: 0, courseStatsPct: null as number | null, profilesPct: null as number | null };
  if (!tableExists(db, "official_programs")) return empty;
  const total = count(db, `
    SELECT COUNT(DISTINCT json_extract(boat.value, '$.registrationNo')) AS value
    FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
    WHERE date = ?
      AND json_extract(boat.value, '$.registrationNo') IS NOT NULL
  `, date);
  if (total === 0) return empty;

  const courseStats = tableExists(db, "racer_course_stats")
    ? count(db, `
      SELECT COUNT(DISTINCT registration_no) AS value
      FROM racer_course_stats
      WHERE registration_no IN (
        SELECT DISTINCT json_extract(boat.value, '$.registrationNo')
        FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
        WHERE date = ?
          AND json_extract(boat.value, '$.registrationNo') IS NOT NULL
      )
    `, date)
    : 0;
  const profiles = tableExists(db, "racer_profiles")
    ? count(db, `
      SELECT COUNT(DISTINCT registration_no) AS value
      FROM racer_profiles
      WHERE flying_count IS NOT NULL
        AND registration_no IN (
          SELECT DISTINCT json_extract(boat.value, '$.registrationNo')
          FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
          WHERE date = ?
            AND json_extract(boat.value, '$.registrationNo') IS NOT NULL
        )
    `, date)
    : 0;

  return {
    total,
    courseStats,
    profiles,
    courseStatsPct: pctNumber(courseStats, total),
    profilesPct: pctNumber(profiles, total),
  };
}

function buildDataCoverage(db: DatabaseSync) {
  const weather = tableExists(db, "race_weather")
    ? count(db, "SELECT COUNT(*) AS value FROM race_weather WHERE wind_speed_mps IS NOT NULL OR wave_height_cm IS NOT NULL")
    : 0;
  const exhibition = tableExists(db, "exhibition_data")
    ? count(db, "SELECT COUNT(*) AS value FROM exhibition_data WHERE exhibition_time IS NOT NULL")
    : 0;
  const equipment = tableExists(db, "race_equipment")
    ? count(db, "SELECT COUNT(*) AS value FROM race_equipment")
    : 0;
  const tilt = tableExists(db, "race_equipment")
    ? count(db, "SELECT COUNT(*) AS value FROM race_equipment WHERE tilt_angle IS NOT NULL")
    : 0;
  const parts = tableExists(db, "race_equipment")
    ? count(db, "SELECT COUNT(*) AS value FROM race_equipment WHERE parts_changed_count > 0 OR propeller_changed = 1")
    : 0;
  return {
    weather: statusByCount(weather, 10_000),
    exhibition: statusByCount(exhibition, 10_000),
    tiltParts: statusByCount(equipment, 10_000),
    detail: {
      weatherRows: weather,
      exhibitionRows: exhibition,
      equipmentRows: equipment,
      tiltRows: tilt,
      partsChangedRows: parts,
    },
  };
}

function buildAlerts(
  date: string,
  freshness: ReturnType<typeof buildReport>["freshness"],
  today: ReturnType<typeof buildReport>["today"],
  racerCoverage: ReturnType<typeof buildRacerCoverage>,
  beforeInfoCoverage: ReturnType<typeof buildBeforeInfoCoverage>,
  dataCoverage: ReturnType<typeof buildDataCoverage>,
  logDiagnostics: ReturnType<typeof buildLogDiagnostics>,
) {
  const alerts: DailyAlert[] = [];

  staleAlert(alerts, freshness.raceResults, "freshness.race_results", 2, 7, "結果データが古い可能性があります。", "npm run fetch:official-results");
  staleAlert(alerts, freshness.officialPrograms, "freshness.official_programs", 1, 3, "番組データが古い可能性があります。", "npm run fetch:official-programs");
  staleAlert(alerts, freshness.decisionHistory, "freshness.decision_history", 1, 3, "判定履歴が更新されていません。", "npm run decision:dry-run");
  staleAlert(alerts, freshness.racerProfiles, "freshness.racer_profiles", 14, 45, "選手プロフィールが古くなっています。", "npm run fetch:racer-stats:dry");
  staleAlert(alerts, freshness.racerCourseStats, "freshness.racer_course_stats", 14, 45, "コース別選手成績が古くなっています。", "npm run fetch:racer-stats:dry");

  if (today.programs === 0) {
    alerts.push({ severity: "warning", code: "today.no_programs", message: `${date} の番組がありません。`, action: "npm run fetch:official-programs" });
  }
  if (today.programs > 0 && today.oddsRaces === 0) {
    alerts.push({ severity: "warning", code: "today.no_odds", message: `${date} の番組はありますが、オッズスナップショットがありません。`, action: "npm run auto:odds" });
  }
  if (today.programs > 0 && today.decisions.total === 0) {
    alerts.push({ severity: "warning", code: "today.no_decisions", message: `${date} の現行モデル判定がありません。`, action: "npm run decision:dry-run" });
  }
  if (racerCoverage.total > 0 && (racerCoverage.courseStatsPct ?? 0) < 98) {
    alerts.push({ severity: "warning", code: "coverage.course_stats_today", message: `今日のコース別選手成績カバー率が ${formatPct(racerCoverage.courseStatsPct)} です。`, action: "npm run fetch:racer-stats:dry" });
  }
  if (racerCoverage.total > 0 && (racerCoverage.profilesPct ?? 0) < 98) {
    alerts.push({ severity: "warning", code: "coverage.profiles_today", message: `今日の選手プロフィールカバー率が ${formatPct(racerCoverage.profilesPct)} です。`, action: "npm run fetch:racer-stats:dry" });
  }
  if (beforeInfoCoverage.totalRaces > 0 && (beforeInfoCoverage.fullPct ?? 0) < 80) {
    alerts.push({ severity: "warning", code: "coverage.beforeinfo_today", message: `今日の直前情報フル取得率が ${formatPct(beforeInfoCoverage.fullPct)} です。`, action: "npm run auto:beforeinfo" });
  }
  if (beforeInfoCoverage.watchBuyRaces > 0 && (beforeInfoCoverage.watchBuyFullPct ?? 0) < 98) {
    alerts.push({ severity: "warning", code: "coverage.beforeinfo_watch_buy", message: `WATCH/BUY対象の直前情報フル取得率が ${formatPct(beforeInfoCoverage.watchBuyFullPct)} です。`, action: "npm run auto:beforeinfo" });
  }
  if (logDiagnostics.autoExhibition.errorLog.activeTotal > 0) {
    alerts.push({ severity: "warning", code: "logs.auto_exhibition_errors", message: `auto-exhibition error log に今日の新形式の失敗が ${logDiagnostics.autoExhibition.errorLog.activeTotal} 件あります。`, action: "npm run readiness" });
  }
  if (dataCoverage.weather !== "OK") {
    alerts.push({ severity: "warning", code: "coverage.weather_partial", message: `天候・風・波データは ${dataCoverage.weather} です。`, action: "npm run report:data-coverage" });
  }
  if (dataCoverage.exhibition !== "OK") {
    alerts.push({ severity: "warning", code: "coverage.exhibition_partial", message: `展示タイムデータは ${dataCoverage.exhibition} です。`, action: "npm run report:data-coverage" });
  }
  if (dataCoverage.tiltParts !== "OK") {
    alerts.push({ severity: "warning", code: "coverage.tilt_parts_partial", message: `チルト・部品交換データは ${dataCoverage.tiltParts} です。`, action: "npm run report:data-coverage" });
  }

  if (alerts.length === 0) {
    alerts.push({ severity: "ok", code: "daily.ok", message: "日次診断で致命的な不足は見つかりませんでした。" });
  }
  return alerts;
}

function staleAlert(alerts: DailyAlert[], info: { latest: string | null; ageDays: number | null }, code: string, warningDays: number, errorDays: number, message: string, action: string) {
  if (!info.latest || info.ageDays == null) {
    alerts.push({ severity: "warning", code, message: `${message} 最新値がありません。`, action });
    return;
  }
  if (info.ageDays > errorDays || info.ageDays < 0) {
    alerts.push({ severity: "error", code, message: `${message} latest=${info.latest} ageDays=${info.ageDays}`, action });
  } else if (info.ageDays > warningDays) {
    alerts.push({ severity: "warning", code, message: `${message} latest=${info.latest} ageDays=${info.ageDays}`, action });
  }
}

function buildNextCommands(alerts: DailyAlert[]) {
  const commands = new Set<string>();
  for (const alert of alerts) {
    if (alert.action?.startsWith("npm run ")) commands.add(alert.action);
  }
  commands.add("npm run status:brief");
  commands.add("npm run readiness");
  if (commands.size === 2) commands.add("npm run report:weekly");
  return [...commands];
}

function latestInfo(db: DatabaseSync, table: string, column: string) {
  if (!tableExists(db, table) || !columnExists(db, table, column)) return { latest: null, ageDays: null };
  const latest = text(db, `SELECT MAX(${column}) AS value FROM ${table}`);
  const latestDate = latest?.slice(0, 10) ?? null;
  return { latest, ageDays: latestDate ? daysBetween(latestDate, todayTokyo()) : null };
}

function statusByCount(countValue: number, okThreshold: number) {
  if (countValue >= okThreshold) return "OK";
  if (countValue > 0) return "PARTIAL";
  return "MISSING";
}

function printMissingDb(report: { dbPath: string; alerts: DailyAlert[]; nextCommands: string[] }) {
  console.error("Boat Pon daily report");
  console.error(`db=${report.dbPath}`);
  for (const alert of report.alerts) console.error(`ERROR\t${alert.code}\t${alert.message}`);
  console.error("\nNext commands:");
  for (const command of report.nextCommands) console.error(`  ${command}`);
}

function printReport(report: ReturnType<typeof buildReport>) {
  console.log("Boat Pon daily report");
  console.log(`date=${report.date} model=${report.modelVersion}`);
  console.log(`db=${report.dbPath}`);
  console.log(`status=${report.ok ? "OK" : "ERROR"} warnings=${report.warningCount} errors=${report.errorCount}`);
  console.log("");
  console.log("Freshness:");
  for (const [key, value] of Object.entries(report.freshness)) {
    console.log(`  ${key}: latest=${value.latest ?? "-"} ageDays=${value.ageDays ?? "-"}`);
  }
  console.log("");
  console.log("Today:");
  console.log(`  programs=${report.today.programs} oddsSnapshots=${report.today.oddsSnapshots} oddsRaces=${report.today.oddsRaces}`);
  console.log(`  decisions BUY=${report.today.decisions.BUY} WATCH=${report.today.decisions.WATCH} SKIP=${report.today.decisions.SKIP} total=${report.today.decisions.total}`);
  console.log(`  racers=${report.racerCoverage.total} courseStats=${report.racerCoverage.courseStats} (${formatPct(report.racerCoverage.courseStatsPct)}) profiles=${report.racerCoverage.profiles} (${formatPct(report.racerCoverage.profilesPct)})`);
  console.log(`  beforeInfo full=${report.beforeInfoCoverage.fullRaces}/${report.beforeInfoCoverage.totalRaces} (${formatPct(report.beforeInfoCoverage.fullPct)}) exhibition=${formatPct(report.beforeInfoCoverage.exhibitionPct)} weather=${formatPct(report.beforeInfoCoverage.weatherPct)} equipment=${formatPct(report.beforeInfoCoverage.equipmentPct)}`);
  console.log(`  beforeInfo WATCH/BUY=${report.beforeInfoCoverage.watchBuyFullRaces}/${report.beforeInfoCoverage.watchBuyRaces} (${formatPct(report.beforeInfoCoverage.watchBuyFullPct)})`);
  console.log(`  autoExhibition errors=${report.logDiagnostics.autoExhibition.errorLog.activeTotal} legacy=${report.logDiagnostics.autoExhibition.errorLog.legacyTotal} kinds=${JSON.stringify(report.logDiagnostics.autoExhibition.errorLog.byKind)}`);
  console.log("");
  console.log("Data coverage:");
  console.log(`  weather=${report.dataCoverage.weather} exhibition=${report.dataCoverage.exhibition} tiltParts=${report.dataCoverage.tiltParts}`);
  console.log("");
  console.log("Alerts:");
  for (const alert of report.alerts) {
    const mark = alert.severity === "ok" ? "OK" : alert.severity === "warning" ? "WARN" : "ERROR";
    console.log(`${mark}\t${alert.code}\t${alert.message}`);
    if (alert.action) console.log(`  action: ${alert.action}`);
  }
  console.log("\nNext commands:");
  for (const command of report.nextCommands) console.log(`  ${command}`);
  console.log("\nSafety: read-only / no auto betting / no auto rule adoption");
}

function tableExists(db: DatabaseSync, table: string) {
  return db.prepare("SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name=?").get(table) != null;
}
function columnExists(db: DatabaseSync, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}
function count(db: DatabaseSync, sql: string, ...params: Array<string | number | null>) {
  const row = db.prepare(sql).get(...params) as CountRow | undefined;
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
function pctNumber(num: number, denom: number) {
  if (denom === 0) return null;
  return Math.round((num / denom) * 1000) / 10;
}
function formatPct(value: number | null) {
  return value == null ? "n/a" : `${value.toFixed(1)}%`;
}
