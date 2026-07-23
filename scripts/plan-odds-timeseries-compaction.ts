/** 時系列重複のcompact計画を作る。読み取り専用でDB変更はしない。 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { selectRetainedCaptures, type OddsCaptureSummary } from "../src/domain/oddsTimeseriesCompaction";

const argv = process.argv.slice(2);
const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = valueOf("--from") ?? "2026-06-01";
const TO = valueOf("--to") ?? todayJst();
if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000; PRAGMA temp_store=MEMORY;");
const query = db.prepare(`
  SELECT
    race_id,
    checkpoint_label,
    captured_at,
    MIN(minutes_before_close) AS minutes_before_close,
    COUNT(*) AS row_count,
    COUNT(DISTINCT selection) AS selection_count
  FROM odds_timeseries_snapshots
  WHERE race_id >= ? AND race_id < ?
  GROUP BY race_id, checkpoint_label, captured_at
`);

const days = dateRange(FROM, TO).map((date) => {
  const raw = query.all(date.replaceAll("-", ""), addDays(date, 1).replaceAll("-", "")) as Array<Record<string, unknown>>;
  const captures: OddsCaptureSummary[] = raw.map((row) => ({
    raceId: String(row.race_id),
    checkpointLabel: row.checkpoint_label == null ? null : String(row.checkpoint_label),
    capturedAt: String(row.captured_at),
    minutesBeforeClose: row.minutes_before_close == null ? null : Number(row.minutes_before_close),
    rowCount: Number(row.row_count),
    selectionCount: Number(row.selection_count),
  }));
  const retained = selectRetainedCaptures(captures);
  const originalRows = captures.reduce((sum, row) => sum + row.rowCount, 0);
  const retainedRows = retained.reduce((sum, row) => sum + row.rowCount, 0);
  const groupsWithComplete = new Set(captures.filter((row) => row.selectionCount >= 120).map(groupKey));
  const retainedComplete = new Set(retained.filter((row) => row.selectionCount >= 120).map(groupKey));
  return {
    date,
    captures: captures.length,
    retainedCaptures: retained.length,
    originalRows,
    retainedRows,
    removableRows: originalRows - retainedRows,
    retentionRatio: originalRows > 0 ? retainedRows / originalRows : null,
    completeGroupsBefore: groupsWithComplete.size,
    completeGroupsAfter: retainedComplete.size,
    completeGroupsPreserved: groupsWithComplete.size === retainedComplete.size,
  };
});
db.close();

const totals = days.reduce((acc, day) => ({
  captures: acc.captures + day.captures,
  retainedCaptures: acc.retainedCaptures + day.retainedCaptures,
  originalRows: acc.originalRows + day.originalRows,
  retainedRows: acc.retainedRows + day.retainedRows,
  removableRows: acc.removableRows + day.removableRows,
  completeGroupsBefore: acc.completeGroupsBefore + day.completeGroupsBefore,
  completeGroupsAfter: acc.completeGroupsAfter + day.completeGroupsAfter,
}), { captures: 0, retainedCaptures: 0, originalRows: 0, retainedRows: 0, removableRows: 0, completeGroupsBefore: 0, completeGroupsAfter: 0 });
const retentionRatio = totals.originalRows > 0 ? totals.retainedRows / totals.originalRows : null;
const databaseBytes = statSync(DB_PATH).size;
const timeseriesPhysicalBytes = 5_204_979_712 + 3_527_729_152;
const estimatedCompactBytes = databaseBytes - timeseriesPhysicalBytes + timeseriesPhysicalBytes * (retentionRatio ?? 1);
const report = {
  generatedAt: new Date().toISOString(),
  window: { from: FROM, to: TO },
  safety: { readOnly: true, dbWrites: false, deletePerformed: false, vacuumPerformed: false },
  retentionPolicy: "race/checkpointごとに目標分へ最も近い完全120通りcaptureと最新captureを保持。完全captureが無ければ最新のみ。",
  totals: { ...totals, retentionRatio, completeGroupsPreserved: totals.completeGroupsBefore === totals.completeGroupsAfter },
  physicalEstimate: { databaseBytes, timeseriesPhysicalBytes, estimatedCompactBytes, estimatedReclaimBytes: databaseBytes - estimatedCompactBytes },
  days,
};

const lines = [
  "# Odds timeseries compaction plan",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> 読み取り専用の計画。DELETE・VACUUM・DB切替は実行していない。",
  "",
  `- 保持規則: ${report.retentionPolicy}`,
  `- 元rows: ${integer(totals.originalRows)}`,
  `- 保持rows: ${integer(totals.retainedRows)}（${percent(retentionRatio)}）`,
  `- 削減候補rows: ${integer(totals.removableRows)}`,
  `- 完全市場group保持: ${integer(totals.completeGroupsAfter)}/${integer(totals.completeGroupsBefore)}（${report.totals.completeGroupsPreserved ? "PASS" : "FAIL"}）`,
  `- 推定DBサイズ: ${gib(databaseBytes)}GiB → ${gib(estimatedCompactBytes)}GiB（約${gib(databaseBytes - estimatedCompactBytes)}GiB回収）`,
  "",
  "## 日別",
  "",
  "| 日 | 元rows | 保持rows | 保持率 | 完全市場保持 |",
  "|---|---:|---:|---:|---:|",
  ...days.map((day) => `| ${day.date} | ${integer(day.originalRows)} | ${integer(day.retainedRows)} | ${percent(day.retentionRatio)} | ${day.completeGroupsAfter}/${day.completeGroupsBefore} |`),
  "",
  "## 実行条件",
  "",
  "- 収集ジョブ停止、最新バックアップ、compact先DBへの書き出し、integrity_check、件数・市場fingerprint比較、原本を残したatomic切替が必要。",
  "- リポジトリ規則によりエージェントはDB削除・更新を実行しない。人間の保守作業として別途承認・実行する。",
];

mkdirSync("reports", { recursive: true });
writeFileSync("reports/odds-timeseries-compaction-plan.json", `${JSON.stringify(report, null, 2)}\n`);
writeFileSync("reports/odds-timeseries-compaction-plan.md", `${lines.join("\n")}\n`);
console.log("[odds-timeseries-compaction-plan] wrote reports/odds-timeseries-compaction-plan.md / .json");

function groupKey(row: OddsCaptureSummary) { return `${row.raceId}/${row.checkpointLabel ?? ""}`; }
function valueOf(name: string) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] ?? null : null; }
function dateRange(from: string, to: string) { const dates: string[] = []; for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date); return dates; }
function addDays(date: string, delta: number) { const value = new Date(`${date}T00:00:00+09:00`); value.setUTCDate(value.getUTCDate() + delta); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(value); }
function todayJst() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()); }
function integer(value: number) { return value.toLocaleString("en-US"); }
function percent(value: number | null) { return value == null ? "-" : `${(value * 100).toFixed(2)}%`; }
function gib(value: number) { return (value / 1024 ** 3).toFixed(2); }
