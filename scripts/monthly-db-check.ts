/**
 * 月1回の DB の点検（2026-10-16、ユーザーの要望「DB も含め破綻しないようにしたい」）。本番の DB は読み取りだけ。
 *
 * 1. 壊れていないか: 本番の DB に PRAGMA quick_check（読み取り専用）。
 * 2. 復旧の練習: 取り直せない記録の書き出し（判定・通知・設定と、直近7日分の締切前のオッズの時系列）を、
 *    一時ディレクトリの新しい DB に戻し、行数が書き出しと本番の DB に合うかを確かめる（戻せないバックアップは、無いのと同じ）。
 *    本番の DB の行が、前の晩の書き出しより減っていたら、それも問題として出す（行が消えた疑い）。
 * 3. 複製先（BOAT_PON_EXPORT_MIRROR_DIR）に、同じ書き出しがあるか。
 *
 * 結果は data/reports/scorecard/db-check.json。スコアカードが「問題あり」と「40日以上点検していない」を注意にする。
 * 使い方: npx tsx scripts/monthly-db-check.ts [--if-due] [--output <path>]
 *   --if-due: 前回の点検が問題なしで、28 日たっていなければ何もしない（前回に問題があれば毎回やり直す）
 *   --output: 結果の置き場所（手で練習するとき用。既定は data/reports/scorecard/db-check.json）
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { loadEnvFiles } from "../src/domain/envFile";
import { expandOddsTimeseriesCaptures, type OddsTimeseriesCapture } from "../src/domain/oddsTimeseriesExport";
import { addDays, todayJst } from "./lib/marketCaptures";

const outputArg = process.argv.indexOf("--output");
const OUTPUT = outputArg >= 0 ? process.argv[outputArg + 1] : "data/reports/scorecard/db-check.json";
const RECORDS = "data/exports/records/latest.jsonl.gz";
const ODDS_ROOT = "data/exports/odds-timeseries";
const RECORD_TABLES: Record<string, string> = { decision_history: "run_kind = 'paper-live'", notification_log: "1 = 1", app_settings: "1 = 1" };

if (process.argv.includes("--if-due") && existsSync(OUTPUT)) {
  try {
    const last = JSON.parse(readFileSync(OUTPUT, "utf8")) as { checkedAt?: string; ok?: boolean };
    if (last.ok && last.checkedAt && Date.now() - Date.parse(last.checkedAt) < 28 * 86_400_000) {
      console.log(`monthly-db-check: skip（前回 ${last.checkedAt}）`);
      process.exit(0);
    }
  } catch { /* 読めなければ点検する */ }
}

loadEnvFiles([".env"]);
const started = Date.now();
const problems: string[] = [];
const prod = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
const tempDir = mkdtempSync(join(tmpdir(), "boat-pon-restore-"));
let quickCheck: string[] = [];
let quickCheckSeconds = 0;
const records: Record<string, { exported: number; restored: number; production: number }> = {};
const odds: Array<{ date: string; exported: number; restored: number; production: number }> = [];
let mirror: { set: boolean; records: boolean | null; odds: boolean | null } = { set: false, records: null, odds: null };

try {
  // 1. 壊れていないか
  const t = Date.now();
  quickCheck = (prod.prepare("PRAGMA quick_check").all() as Array<Record<string, string>>).map((row) => Object.values(row)[0]);
  quickCheckSeconds = Math.round((Date.now() - t) / 1000);
  if (!(quickCheck.length === 1 && quickCheck[0] === "ok")) problems.push(`quick_check: ${quickCheck.slice(0, 3).join(" / ")}`);

  // 2. 復旧の練習（新しい DB に、本番と同じ形の表を作って戻す）
  const restore = new DatabaseSync(join(tempDir, "restore.sqlite"));
  const schema = prod.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN (${[...Object.keys(RECORD_TABLES), "odds_timeseries_snapshots"].map(() => "?").join(",")})`)
    .all(...Object.keys(RECORD_TABLES), "odds_timeseries_snapshots") as Array<{ name: string; sql: string }>;
  for (const { sql } of schema) restore.exec(sql);

  if (!existsSync(RECORDS)) {
    problems.push(`記録の書き出し（${RECORDS}）が無い`);
  } else {
    const byTable = new Map<string, Array<Record<string, unknown>>>();
    for (const line of gunzipSync(readFileSync(RECORDS)).toString("utf8").split("\n")) {
      if (!line) continue;
      const { table, row } = JSON.parse(line) as { table: string; row: Record<string, unknown> };
      (byTable.get(table) ?? byTable.set(table, []).get(table)!).push(row);
    }
    restore.exec("BEGIN");
    for (const [table, where] of Object.entries(RECORD_TABLES)) {
      const rows = byTable.get(table) ?? [];
      let restored = 0;
      if (rows.length) {
        const columns = Object.keys(rows[0]);
        const insert = restore.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
        for (const row of rows) { insert.run(...columns.map((c) => row[c] as string | number | null)); restored += 1; }
      }
      const production = (prod.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
      records[table] = { exported: rows.length, restored, production };
      if (restored !== rows.length) problems.push(`${table}: 書き出し ${rows.length} 行のうち ${restored} 行しか戻せない`);
      if (production < rows.length) problems.push(`${table}: 本番の DB（${production} 行）が前の書き出し（${rows.length} 行）より少ない`);
    }
    restore.exec("COMMIT");
  }

  // 直近7日分（今日を除く）の締切前のオッズの時系列を戻し、本番の DB のその日の行数と比べる
  const insertOdds = restore.prepare(`INSERT INTO odds_timeseries_snapshots (race_id, selection, odds, popularity, source, captured_at, minutes_before_close, checkpoint_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const countOdds = prod.prepare(`SELECT COUNT(*) AS n FROM odds_timeseries_snapshots WHERE race_id >= ? AND race_id < ?`);
  restore.exec("BEGIN");
  for (let i = 7; i >= 1; i -= 1) {
    const date = addDays(todayJst(), -i);
    const path = join(ODDS_ROOT, date.slice(0, 4), `${date}.jsonl.gz`);
    const production = (countOdds.get(date.replaceAll("-", ""), addDays(date, 1).replaceAll("-", "")) as { n: number }).n;
    if (!existsSync(path)) {
      if (production > 0) problems.push(`${date} のオッズの時系列の書き出しが無い（DB には ${production} 行）`);
      continue;
    }
    const captures = gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as OddsTimeseriesCapture);
    const rows = expandOddsTimeseriesCaptures(captures);
    for (const r of rows) insertOdds.run(r.race_id, r.selection, r.odds, r.popularity, r.source, r.captured_at, r.minutes_before_close, r.checkpoint_label);
    const restored = (restore.prepare(`SELECT COUNT(*) AS n FROM odds_timeseries_snapshots WHERE race_id >= ? AND race_id < ?`)
      .get(date.replaceAll("-", ""), addDays(date, 1).replaceAll("-", "")) as { n: number }).n;
    odds.push({ date, exported: rows.length, restored, production });
    if (restored !== rows.length) problems.push(`${date} のオッズ: 書き出し ${rows.length} 行のうち ${restored} 行しか戻せない`);
    if (production !== rows.length) problems.push(`${date} のオッズ: 書き出し ${rows.length} 行と本番の DB ${production} 行が違う`);
  }
  restore.exec("COMMIT");
  restore.close();

  // 3. 複製先
  const mirrorDir = process.env.BOAT_PON_EXPORT_MIRROR_DIR?.trim();
  if (mirrorDir) {
    const same = (relative: string, local: string) => existsSync(join(mirrorDir, relative)) && existsSync(local) && statSync(join(mirrorDir, relative)).size === statSync(local).size;
    const latestOdds = existsSync(ODDS_ROOT)
      ? readdirSync(ODDS_ROOT).filter((y) => /^\d{4}$/.test(y)).flatMap((y) => readdirSync(join(ODDS_ROOT, y)).map((f) => join(y, f))).filter((f) => f.endsWith(".jsonl.gz")).sort().at(-1)
      : undefined;
    mirror = {
      set: true,
      records: same(join("records", "latest.jsonl.gz"), RECORDS),
      odds: latestOdds ? same(join("odds-timeseries", latestOdds), join(ODDS_ROOT, latestOdds)) : null,
    };
    if (mirror.records === false) problems.push("複製先の記録の書き出しが、手元と違う・無い");
    if (mirror.odds === false) problems.push(`複製先のオッズの時系列（${latestOdds}）が、手元と違う・無い`);
  }
} catch (err) {
  problems.push(`点検が途中で止まった: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  prod.close();
  rmSync(tempDir, { recursive: true, force: true });
}

const result = {
  checkedAt: new Date().toISOString(),
  ok: problems.length === 0,
  problems,
  quickCheck: quickCheck.slice(0, 5),
  quickCheckSeconds,
  totalSeconds: Math.round((Date.now() - started) / 1000),
  restore: { records, odds },
  mirror,
};
writeFileSync(`${OUTPUT}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
renameSync(`${OUTPUT}.tmp`, OUTPUT);
console.log(`monthly-db-check: ${result.ok ? "ok" : `問題 ${problems.length} 件: ${problems.join(" / ")}`}（quick_check ${quickCheckSeconds} 秒・全体 ${result.totalSeconds} 秒）`);
if (!result.ok) process.exitCode = 1;
