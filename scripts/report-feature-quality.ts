import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

type Row = {
  decision: string;
  selection: string;
  result: string | null;
  returned: number;
  current_odds: number | null;
  wind_speed_mps: number | null;
  wave_height_cm: number | null;
  stable_plate: number | null;
  shortened_laps: number | null;
  exhibition_st_residual_sum: number | null;
  max_tilt_angle: number | null;
  min_tilt_angle: number | null;
  parts_changed_count: number | null;
  propeller_changed_count: number | null;
};
type Summary = { rows: number; buy: number; settledBuy: number; hits: number; hitRate: number | null; roi: number | null };
type Group = Summary & { key: string };

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));
const to = args.to ?? todayTokyo();
const from = args.from ?? addDays(to, -(args.days - 1));

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const rows = listRows(db, from, to);
  const report = {
    generatedAt: new Date().toISOString(),
    from,
    to,
    modelVersion: LIVE_MONITOR_MODEL_VERSION,
    rows: rows.length,
    coverage: featureCoverage(rows),
    byWind: groups(rows, windBucket),
    byWave: groups(rows, waveBucket),
    byEnvironment: groups(rows, environmentBucket),
    byExhibitionResidual: groups(rows, residualBucket),
    byTilt: groups(rows, tiltBucket),
    byParts: groups(rows, partsBucket),
    guardrail: "特徴量の観察用。nが小さい区分は採用しない。live設定変更・自動投票は行わない。",
  };
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
} finally {
  db.close();
}

function listRows(db: DatabaseSync, from: string, to: string): Row[] {
  if (!tableExists(db, "decision_history")) return [];
  const hasWeather = tableExists(db, "race_weather");
  const hasEquipment = tableExists(db, "race_equipment");
  const weatherSelect = hasWeather
    ? "w.wind_speed_mps, w.wave_height_cm, w.stable_plate, w.shortened_laps"
    : "NULL AS wind_speed_mps, NULL AS wave_height_cm, NULL AS stable_plate, NULL AS shortened_laps";
  const equipmentJoin = hasEquipment
    ? `LEFT JOIN (
        SELECT race_id,
          MAX(tilt_angle) AS max_tilt_angle,
          MIN(tilt_angle) AS min_tilt_angle,
          SUM(parts_changed_count) AS parts_changed_count,
          SUM(propeller_changed) AS propeller_changed_count
        FROM race_equipment
        GROUP BY race_id
      ) q ON q.race_id = dh.race_id`
    : "";
  const equipmentSelect = hasEquipment
    ? "q.max_tilt_angle, q.min_tilt_angle, q.parts_changed_count, q.propeller_changed_count"
    : "NULL AS max_tilt_angle, NULL AS min_tilt_angle, NULL AS parts_changed_count, NULL AS propeller_changed_count";
  const weatherJoin = hasWeather ? "LEFT JOIN race_weather w ON w.race_id = dh.race_id" : "";
  return db.prepare(`
SELECT dh.decision, dh.selection, dh.result, dh.returned, dh.current_odds,
       dh.exhibition_st_residual_sum,
       ${weatherSelect},
       ${equipmentSelect}
FROM decision_history dh
${weatherJoin}
${equipmentJoin}
WHERE dh.date >= ? AND dh.date <= ? AND dh.model_version = ?
ORDER BY dh.date, dh.venue, dh.race_no
`).all(from, to, LIVE_MONITOR_MODEL_VERSION) as Row[];
}

function featureCoverage(rows: Row[]) {
  return {
    weatherPct: pctNumber(rows.filter((r) => r.wind_speed_mps != null || r.wave_height_cm != null).length, rows.length),
    exhibitionResidualPct: pctNumber(rows.filter((r) => r.exhibition_st_residual_sum != null).length, rows.length),
    equipmentPct: pctNumber(rows.filter((r) => r.max_tilt_angle != null || r.min_tilt_angle != null).length, rows.length),
    buyRows: rows.filter((r) => r.decision === "BUY").length,
  };
}

function groups(rows: Row[], keyFor: (row: Row) => string): Group[] {
  const map = new Map<string, Row[]>();
  for (const row of rows) map.set(keyFor(row), [...(map.get(keyFor(row)) ?? []), row]);
  return [...map.entries()].map(([key, value]) => ({ key, ...summarize(value) })).sort((a, b) => a.key.localeCompare(b.key, "ja"));
}

function summarize(rows: Row[]): Summary {
  const buyRows = rows.filter((r) => r.decision === "BUY");
  const settled = buyRows.filter((r) => r.returned === 0 && r.result != null);
  const hits = settled.filter((r) => r.selection === r.result);
  const payoutOdds = hits.reduce((sum, r) => sum + (r.current_odds ?? 0), 0);
  return {
    rows: rows.length,
    buy: buyRows.length,
    settledBuy: settled.length,
    hits: hits.length,
    hitRate: settled.length ? hits.length / settled.length : null,
    roi: settled.length ? payoutOdds / settled.length : null,
  };
}

function windBucket(row: Row) {
  const wind = row.wind_speed_mps;
  if (wind == null) return "unknown";
  if (wind >= 8) return "wind>=8";
  if (wind >= 5) return "wind5-7";
  return "wind<5";
}
function waveBucket(row: Row) {
  const wave = row.wave_height_cm;
  if (wave == null) return "unknown";
  if (wave >= 8) return "wave>=8";
  if (wave >= 5) return "wave5-7";
  return "wave<5";
}
function environmentBucket(row: Row) {
  if (row.stable_plate) return "stable_plate";
  if (row.shortened_laps) return "shortened_laps";
  return "normal_or_unknown";
}
function residualBucket(row: Row) {
  const residual = row.exhibition_st_residual_sum;
  if (residual == null) return "unknown";
  if (residual >= 0.15) return "st_residual_good";
  if (residual <= -0.15) return "st_residual_bad";
  return "st_residual_flat";
}
function tiltBucket(row: Row) {
  if (row.max_tilt_angle == null && row.min_tilt_angle == null) return "unknown";
  if ((row.max_tilt_angle ?? 0) >= 0.5 || (row.min_tilt_angle ?? 0) <= -0.5) return "tilt_extreme";
  return "tilt_normal";
}
function partsBucket(row: Row) {
  const parts = Number(row.parts_changed_count ?? 0) + Number(row.propeller_changed_count ?? 0);
  if (row.parts_changed_count == null && row.propeller_changed_count == null) return "unknown";
  return parts > 0 ? "changed" : "no_change";
}

function printReport(report: {
  from: string;
  to: string;
  rows: number;
  coverage: ReturnType<typeof featureCoverage>;
  byWind: Group[];
  byWave: Group[];
  byEnvironment: Group[];
  byExhibitionResidual: Group[];
  byTilt: Group[];
  byParts: Group[];
  guardrail: string;
}) {
  console.log("# Boat Pon feature quality");
  console.log(`period: ${report.from}..${report.to}`);
  console.log(`rows=${report.rows} weather=${formatPct(report.coverage.weatherPct)} exhibitionResidual=${formatPct(report.coverage.exhibitionResidualPct)} equipment=${formatPct(report.coverage.equipmentPct)} BUY=${report.coverage.buyRows}`);
  printTable("Wind", report.byWind);
  printTable("Wave", report.byWave);
  printTable("Environment", report.byEnvironment);
  printTable("Exhibition ST residual", report.byExhibitionResidual);
  printTable("Tilt", report.byTilt);
  printTable("Parts/propeller", report.byParts);
  console.log(`\nGuardrail: ${report.guardrail}`);
}

function printTable(title: string, rows: Group[]) {
  console.log(`\n## ${title}`);
  console.log("| key | rows | BUY | settledBUY | hits | hitRate | ROI |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) console.log(`| ${row.key} | ${row.rows} | ${row.buy} | ${row.settledBuy} | ${row.hits} | ${formatRatio(row.hitRate)} | ${formatRatio(row.roi)} |`);
}

function tableExists(db: DatabaseSync, table: string) { return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) != null; }
function todayTokyo() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function addDays(date: string, days: number) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); }
function pctNumber(num: number, denom: number) { return denom === 0 ? null : Math.round((num / denom) * 1000) / 10; }
function formatPct(value: number | null) { return value == null ? "n/a" : `${value.toFixed(1)}%`; }
function formatRatio(value: number | null) { return value == null ? "-" : value.toFixed(3); }
function parseArgs(argv: string[]) {
  const parsed = { from: null as string | null, to: null as string | null, days: 30, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = date(value); i += 1; }
    else if (key === "--to") { parsed.to = date(value); i += 1; }
    else if (key === "--days") { parsed.days = Number(value); i += 1; }
    else if (key === "--json") parsed.json = true;
    else if (key === "--help") { console.log("Usage: npm run report:features -- --days 30 [--json]"); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}
function date(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid date: ${value ?? ""}`);
  return value;
}
