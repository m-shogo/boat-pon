/** odds時系列DBの肥大化を日別に監査する。読み取り専用。 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveN2OddsTimeseriesStorageWindow } from "../src/research-replay/n2OddsTimeseriesStorageWindow";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = process.env.BOAT_PON_FROM ?? "2026-06-01";
const TO = process.env.BOAT_PON_TO ?? todayJst();
const OUT_JSON = "reports/odds-timeseries-storage.json";
const OUT_MD = "reports/odds-timeseries-storage.md";
const window = resolveN2OddsTimeseriesStorageWindow(FROM, TO);
if (!existsSync(DB_PATH)) throw new Error("ODDS_TIMESERIES_STORAGE_AUDIT_DB_UNAVAILABLE");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ODDS_TIMESERIES_STORAGE_AUDIT_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000; PRAGMA temp_store=MEMORY;");
const query = db.prepare(`
  SELECT
    COUNT(*) AS rows,
    COUNT(DISTINCT race_id) AS races,
    COUNT(DISTINCT race_id || char(47) || COALESCE(bet_type, '') || char(47) || COALESCE(checkpoint_label, '') || char(47) || selection) AS unique_keys
  FROM odds_timeseries_snapshots
  WHERE race_id >= ? AND race_id < ?
`);

const days = window.dates.map((date) => {
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
  window: { from: window.from, to: window.to },
  safety: { readOnly: true, dbWrites: false, compactionPerformed: false },
  databaseBytes: statSync(verifiedDbPath).size,
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
  `- race/bet_type/checkpoint/selectionの一意キー: ${integer(report.totals.uniqueKeys)}`,
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
verifyExistingOutput(OUT_JSON, "ODDS_TIMESERIES_STORAGE_PREEXISTING_JSON_IDENTITY_INVALID");
verifyExistingOutput(OUT_MD, "ODDS_TIMESERIES_STORAGE_PREEXISTING_MD_IDENTITY_INVALID");
atomicPublish(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "ODDS_TIMESERIES_STORAGE_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
atomicPublish(OUT_MD, `${lines.join("\n")}\n`, "ODDS_TIMESERIES_STORAGE_MD_PUBLISH_TEMP_IDENTITY_INVALID");
console.log("[odds-timeseries-storage] wrote reports/odds-timeseries-storage.md / .json");

function verifyExistingOutput(path: string, identityErrorCode: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, identityErrorCode);
}

function atomicPublish(path: string, content: string, identityErrorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
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
