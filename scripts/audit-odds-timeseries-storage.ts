/** odds時系列DBの肥大化を日別に監査する。読み取り専用。 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = process.env.BOAT_PON_FROM ?? "2026-06-01";
const TO = process.env.BOAT_PON_TO ?? todayJst();
if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000; PRAGMA temp_store=MEMORY;");
const query = db.prepare(`
  SELECT
    COUNT(*) AS rows,
    COUNT(DISTINCT race_id) AS races,
    COUNT(DISTINCT race_id || char(47) || COALESCE(checkpoint_label, '') || char(47) || selection) AS unique_keys
  FROM odds_timeseries_snapshots
  WHERE race_id >= ? AND race_id < ?
`);

const days = dateRange(FROM, TO).map((date) => {
  const fromId = date.replaceAll("-", "");
  const toId = addDays(date, 1).replaceAll("-", "");
  const row = query.get(fromId, toId) as { rows: number; races: number; unique_keys: number };
  return {
    date,
    rows: Number(row.rows),
    races: Number(row.races),
    uniqueKeys: Number(row.unique_keys),
    redundancyRatio: row.unique_keys > 0 ? row.rows / row.unique_keys : null,
  };
});
db.close();

const totals = days.reduce((acc, day) => ({
  rows: acc.rows + day.rows,
  uniqueKeys: acc.uniqueKeys + day.uniqueKeys,
}), { rows: 0, uniqueKeys: 0 });
const topRedundancy = [...days]
  .filter((day) => day.uniqueKeys > 0)
  .sort((a, b) => (b.redundancyRatio ?? 0) - (a.redundancyRatio ?? 0))
  .slice(0, 15);
const report = {
  generatedAt: new Date().toISOString(),
  window: { from: FROM, to: TO },
  safety: { readOnly: true, dbWrites: false, compactionPerformed: false },
  databaseBytes: statSync(DB_PATH).size,
  totals: {
    ...totals,
    redundantRows: totals.rows - totals.uniqueKeys,
    redundancyRatio: totals.uniqueKeys > 0 ? totals.rows / totals.uniqueKeys : null,
  },
  knownPhysicalBreakdown: {
    measuredAt: "2026-07-21",
    oddsTimeseriesTableBytes: 5_204_979_712,
    oddsTimeseriesIndexBytes: 3_527_729_152,
    note: "dbstat read-only実測。通常監査では全ページ再走査しない。",
  },
  topRedundancy,
  days,
  action: "今後の重複はcollector側で停止済み。過去重複の削除・VACUUMは破壊的かつDB書き込みのため未実施。",
};

const lines = [
  "# Odds timeseries storage audit",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> 読み取り専用。削除・VACUUM・DB更新は実施していない。",
  "",
  `- DBファイル: ${gib(report.databaseBytes)} GiB`,
  `- 対象期間rows: ${integer(report.totals.rows)}`,
  `- race/checkpoint/selectionの一意キー: ${integer(report.totals.uniqueKeys)}`,
  `- 重複相当rows: ${integer(report.totals.redundantRows)}`,
  `- 重複率: ${number(report.totals.redundancyRatio)}x`,
  `- 時系列table: ${gib(report.knownPhysicalBreakdown.oddsTimeseriesTableBytes)} GiB / index: ${gib(report.knownPhysicalBreakdown.oddsTimeseriesIndexBytes)} GiB`,
  "",
  "## 重複率上位日",
  "",
  "| 日 | rows | races | 一意キー | 重複率 |",
  "|---|---:|---:|---:|---:|",
  ...topRedundancy.map((day) => `| ${day.date} | ${integer(day.rows)} | ${integer(day.races)} | ${integer(day.uniqueKeys)} | ${number(day.redundancyRatio)}x |`),
  "",
  "## 判定",
  "",
  "- 旧収集器の同一checkpoint反復保存が主因。collectorの完全checkpointスキップで新規増加は抑制する。",
  "- 過去重複の物理削減には、バックアップ確認後の別途承認された保守作業が必要。現時点では行わない。",
];

mkdirSync("reports", { recursive: true });
writeFileSync("reports/odds-timeseries-storage.json", `${JSON.stringify(report, null, 2)}\n`);
writeFileSync("reports/odds-timeseries-storage.md", `${lines.join("\n")}\n`);
console.log("[odds-timeseries-storage] wrote reports/odds-timeseries-storage.md / .json");

function dateRange(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function addDays(date: string, delta: number) {
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(value);
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function integer(value: number) { return value.toLocaleString("en-US"); }
function number(value: number | null) { return value == null ? "-" : value.toFixed(2); }
function gib(value: number) { return (value / 1024 ** 3).toFixed(2); }
