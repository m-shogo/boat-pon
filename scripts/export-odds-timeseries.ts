/**
 * 締切前のオッズの時系列（odds_timeseries_snapshots）を、1日1ファイルに書き出す（DB は読み取り専用）。
 *
 * この時系列は、レースが終わると公式サイトから取り直せない。DB 全体のバックアップは 16 GB 近くあり、
 * 2026-06-11 を最後に止まっていた（2026-10-15 に判明）。いちばん失いたくないこの部分だけを、小さく毎晩残す。
 *
 * 出力: data/exports/odds-timeseries/YYYY/YYYY-MM-DD.jsonl.gz（1行 = 1回の取得。{raceId, capturedAt, checkpoint, minutesBeforeClose, source, odds: {買い目: オッズ}, popularity?}）
 * 環境変数 BOAT_PON_EXPORT_MIRROR_DIR があれば、同じ相対パスでそこにもコピーする（例: Google Drive のフォルダ。ユーザーが決める）。
 * 既にあるファイルは書き直さない（--force で書き直す）。
 *
 * 使い方: npx tsx scripts/export-odds-timeseries.ts [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD] [--force] [--verify]
 *   --verify: 書き出したファイルを読み直して、DB の行数と一致するかを確かめる
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { addDays, todayJst } from "./lib/marketCaptures";
import { groupOddsTimeseriesRows, type OddsTimeseriesRow } from "../src/domain/oddsTimeseriesExport";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const single = arg("--date");
const FROM = single ?? arg("--from") ?? todayJst();
const TO = single ?? arg("--to") ?? FROM;
const FORCE = args.includes("--force");
const VERIFY = args.includes("--verify");
const EXPORT_ROOT = "data/exports/odds-timeseries";
const MIRROR = process.env.BOAT_PON_EXPORT_MIRROR_DIR?.trim() || null;
for (const d of [FROM, TO]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid date: ${d}`);

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
const query = db.prepare(`SELECT race_id, selection, odds, popularity, source, captured_at, minutes_before_close, checkpoint_label
  FROM odds_timeseries_snapshots WHERE race_id >= ? AND race_id < ? ORDER BY race_id, captured_at, selection`);

// 当日分は、収集が終わる 21:05 より後（21:10 以降）でないと書き出さない（途中の状態で固めないため）。
const jstNow = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const todayFinished = jstNow >= "21:10";
let written = 0, skipped = 0, empty = 0, mirrored = 0, verified = 0, notYet = 0;
try {
  for (let date = FROM; date <= TO; date = addDays(date, 1)) {
    if (date > todayJst() || (date === todayJst() && !todayFinished && !FORCE)) { notYet += 1; continue; }
    const relative = join(date.slice(0, 4), `${date}.jsonl.gz`);
    const path = join(EXPORT_ROOT, relative);
    const prefix = date.replaceAll("-", "");
    const rows = query.all(`${prefix}-`, `${prefix}.`) as OddsTimeseriesRow[];
    if (rows.length === 0) { empty += 1; continue; }
    if (existsSync(path) && !FORCE) {
      skipped += 1;
    } else {
      const lines = groupOddsTimeseriesRows(rows).map((capture) => JSON.stringify(capture)).join("\n");
      mkdirSync(dirname(path), { recursive: true });
      // 途中で止まっても壊れたファイルが残らないよう、一時ファイルに書いてから名前を変える
      writeFileSync(`${path}.tmp`, gzipSync(`${lines}\n`));
      renameSync(`${path}.tmp`, path);
      written += 1;
    }
    if (VERIFY) {
      const count = gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean)
        .reduce((total, line) => total + Object.keys((JSON.parse(line) as { odds: Record<string, number> }).odds).length, 0);
      if (count !== rows.length) throw new Error(`verify failed: ${path} rows=${count} db=${rows.length}`);
      verified += 1;
    }
    if (MIRROR) {
      const target = join(MIRROR, "odds-timeseries", relative);
      if (!existsSync(target) || FORCE) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(path, target);
        mirrored += 1;
      }
    }
  }
} finally {
  db.close();
}
console.log(`export-odds-timeseries done: ${FROM}..${TO} written=${written} skipped=${skipped} empty=${empty} verified=${verified} notYet=${notYet} mirrored=${mirrored}${MIRROR ? "" : " (mirror: 未設定)"}`);
