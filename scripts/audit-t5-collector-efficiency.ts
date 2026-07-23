/** T-5収集の欠測と重複保存を日別に監査する。読み取り専用。 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = process.env.BOAT_PON_FROM ?? "2026-07-20";
const TO = process.env.BOAT_PON_TO ?? todayJst();
const NOW = new Date();
const FIX_EFFECTIVE_AT = new Date(process.env.BOAT_PON_T5_FIX_FROM ?? "2026-07-21T13:40:00+09:00");
const NETWORK_ONLY_EFFECTIVE_AT = new Date(process.env.BOAT_PON_T5_NETWORK_ONLY_FROM ?? "2026-07-21T15:15:00+09:00");

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

type RaceRow = {
  date: string;
  race_id: string;
  close_at: string;
  t10: number;
  t5: number;
  network_t5: number;
  t5_rows: number;
  all_rows: number;
  all_unique: number;
};

const rows = db.prepare(`
  WITH p AS (
    SELECT date, race_id, close_at
    FROM official_programs
    WHERE date >= ? AND date <= ?
  ), capture AS (
    SELECT
      p.date,
      o.race_id,
      o.checkpoint_label,
      o.captured_at,
      COUNT(*) AS rows,
      COUNT(DISTINCT o.selection) AS selections
    FROM p
    JOIN odds_timeseries_snapshots o ON o.race_id = p.race_id
    GROUP BY p.date, o.race_id, o.checkpoint_label, o.captured_at
  ), market AS (
    SELECT
      race_id,
      MAX(CASE WHEN checkpoint_label = 'T-10' THEN selections ELSE 0 END) AS t10,
      MAX(CASE WHEN checkpoint_label = 'T-5' THEN selections ELSE 0 END) AS t5,
      MAX(CASE WHEN checkpoint_label = 'T-5' AND captured_at >= ? THEN selections ELSE 0 END) AS network_t5,
      MAX(CASE WHEN checkpoint_label = 'T-5' THEN rows ELSE 0 END) AS t5_rows
    FROM capture
    GROUP BY race_id
  ), storage AS (
    SELECT
      p.race_id,
      COUNT(*) AS all_rows,
      COUNT(DISTINCT COALESCE(o.checkpoint_label, '') || char(47) || o.selection) AS all_unique
    FROM p
    JOIN odds_timeseries_snapshots o ON o.race_id = p.race_id
    GROUP BY p.race_id
  )
  SELECT
    p.date,
    p.race_id,
    p.close_at,
    COALESCE(m.t10, 0) AS t10,
    COALESCE(m.t5, 0) AS t5,
    COALESCE(m.network_t5, 0) AS network_t5,
    COALESCE(m.t5_rows, 0) AS t5_rows,
    COALESCE(s.all_rows, 0) AS all_rows,
    COALESCE(s.all_unique, 0) AS all_unique
  FROM p
  LEFT JOIN market m ON m.race_id = p.race_id
  LEFT JOIN storage s ON s.race_id = p.race_id
  ORDER BY p.date, p.close_at, p.race_id
`).all(FROM, TO, NETWORK_ONLY_EFFECTIVE_AT.toISOString()) as RaceRow[];
db.close();

const dates = [...new Set(rows.map((row) => row.date))];
const days = dates.map((date) => {
  const daily = rows.filter((row) => row.date === date);
  // 当日は締切済みレースだけを暫定coverage母数にし、未開催を欠測扱いしない。
  const mature = daily.filter((row) => raceClose(date, row.close_at) <= NOW);
  const t10Full = mature.filter((row) => row.t10 >= 120).length;
  const t5Full = mature.filter((row) => row.t5 >= 120).length;
  const rawRows = mature.reduce((sum, row) => sum + row.all_rows, 0);
  const uniqueRows = mature.reduce((sum, row) => sum + row.all_unique, 0);
  return {
    date,
    programs: daily.length,
    maturePrograms: mature.length,
    futurePrograms: daily.length - mature.length,
    t10Full,
    t5Full,
    t5Coverage: mature.length > 0 ? t5Full / mature.length : 0,
    t10WithoutT5: mature.filter((row) => row.t10 >= 120 && row.t5 < 120).length,
    t5Partial: mature.filter((row) => row.t5 > 0 && row.t5 < 120).length,
    rawRows,
    uniqueRows,
    redundancyRatio: uniqueRows > 0 ? rawRows / uniqueRows : null,
  };
});

const completeDays = days.filter((day) => day.date < todayJst());
const postFixRaces = rows.filter((row) => {
  const close = raceClose(row.date, row.close_at);
  return close >= FIX_EFFECTIVE_AT && close <= NOW;
});
const postFixT5Full = postFixRaces.filter((row) => row.t5 >= 120).length;
const networkOnlyRaces = rows.filter((row) => {
  const close = raceClose(row.date, row.close_at);
  return close >= NETWORK_ONLY_EFFECTIVE_AT && close <= NOW;
});
const networkOnlyT5Full = networkOnlyRaces.filter((row) => row.network_t5 >= 120).length;
const report = {
  generatedAt: NOW.toISOString(),
  window: { from: FROM, to: TO },
  safety: { readOnly: true, dbWrites: false },
  denominator: "当日は締切済み、過去日は全番組",
  postFixCohort: {
    effectiveAt: FIX_EFFECTIVE_AT.toISOString(),
    maturePrograms: postFixRaces.length,
    t5Full: postFixT5Full,
    coverage: postFixRaces.length > 0 ? postFixT5Full / postFixRaces.length : null,
    t10WithoutT5: postFixRaces.filter((row) => row.t10 >= 120 && row.t5 < 120).length,
  },
  networkOnlyCohort: {
    effectiveAt: NETWORK_ONLY_EFFECTIVE_AT.toISOString(),
    maturePrograms: networkOnlyRaces.length,
    t5Full: networkOnlyT5Full,
    coverage: networkOnlyRaces.length > 0 ? networkOnlyT5Full / networkOnlyRaces.length : null,
  },
  days,
  gate: {
    targetDailyCoverage: 0.8,
    completeDays,
    passingDays: completeDays.filter((day) => day.programs > 0 && day.t5Full / day.programs >= 0.8).length,
  },
};

const lines = [
  "# T-5 collector efficiency",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> 読み取り専用。当日は締切済みレースだけを暫定coverage母数にし、未開催レースを欠測扱いしない。",
  "",
  "| 日 | 全番組 | 締切済み | 未開催 | T-10完全 | T-5完全 | coverage | T-10あり/T-5欠測 | T-5部分 | 保存重複率 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...days.map((day) => `| ${day.date} | ${day.programs} | ${day.maturePrograms} | ${day.futurePrograms} | ${day.t10Full} | ${day.t5Full} | ${percent(day.t5Coverage)} | ${day.t10WithoutT5} | ${day.t5Partial} | ${number(day.redundancyRatio)}x |`),
  "",
  `完了日の日次80% gate: ${report.gate.passingDays}/${report.gate.completeDays.length}`,
  "",
  `修正後cohort（${report.postFixCohort.effectiveAt}以降に締切済み）: ${report.postFixCohort.t5Full}/${report.postFixCohort.maturePrograms} = ${report.postFixCohort.coverage == null ? "-" : percent(report.postFixCohort.coverage)}、T-10あり/T-5欠測=${report.postFixCohort.t10WithoutT5}`,
  "",
  `network-only正式cohort（${report.networkOnlyCohort.effectiveAt}以降に締切済み）: ${report.networkOnlyCohort.t5Full}/${report.networkOnlyCohort.maturePrograms} = ${report.networkOnlyCohort.coverage == null ? "-" : percent(report.networkOnlyCohort.coverage)}`,
  "",
  "- 修正効果は2026-07-21以降の日次coverage、T-10あり/T-5欠測、保存重複率で判定する。",
];

mkdirSync("reports", { recursive: true });
writeFileSync("reports/t5-collector-efficiency.json", `${JSON.stringify(report, null, 2)}\n`);
writeFileSync("reports/t5-collector-efficiency.md", `${lines.join("\n")}\n`);
console.log("[t5-collector-efficiency] wrote reports/t5-collector-efficiency.md / .json");

function raceClose(date: string, closeAt: string) {
  return new Date(`${date}T${closeAt}:00+09:00`);
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function number(value: number | null) {
  return value == null ? "-" : value.toFixed(2);
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
