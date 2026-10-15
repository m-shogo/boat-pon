/**
 * 締切前のオッズの時系列（odds_timeseries_snapshots）を、1日1ファイルに書き出す（DB は読み取り専用）。
 *
 * この時系列は、レースが終わると公式サイトから取り直せない。DB 全体のバックアップは 16 GB 近くあり、
 * 2026-06-11 を最後に止まっていた（2026-10-15 に判明）。いちばん失いたくないこの部分だけを、小さく毎晩残す。
 *
 * 出力: data/exports/odds-timeseries/YYYY/YYYY-MM-DD.jsonl.gz（1行 = 1回の取得。{raceId, capturedAt, checkpoint, minutesBeforeClose, source, rows: [[買い目, オッズ, 人気]]}。
 *       重複行も捨てない。src/domain/oddsTimeseriesExport.ts の expandOddsTimeseriesCaptures で DB の行に戻せる）
 * 環境変数 BOAT_PON_EXPORT_MIRROR_DIR があれば、同じ相対パスでそこにもコピーする（例: Google Drive のフォルダ。ユーザーが決める）。
 * 既にあるファイルは書き直さない（--force で書き直す。--verify のときは中身を DB と全列で突き合わせ、違えば書き直す）。
 * 書き出しも複製も、一時ファイルに書いて確かめてから正式な名前にする。当日分は 21:10 より前は書かない（--force でも）。
 *
 * 使い方: npx tsx scripts/export-odds-timeseries.ts [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD] [--force] [--verify]
 *   --verify: ファイルの中身が DB の行と全列で一致するかを確かめる（一致しない日は書き直す。書き直しても一致しなければ失敗として数え、終了コード 1）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadEnvFiles } from "../src/domain/envFile";
import { addDays, todayJst } from "./lib/marketCaptures";
import {
  canonicalOddsTimeseriesRows, expandOddsTimeseriesCaptures, groupOddsTimeseriesRows,
  type OddsTimeseriesCapture, type OddsTimeseriesRow,
} from "../src/domain/oddsTimeseriesExport";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const single = arg("--date");
const FROM = single ?? arg("--from") ?? todayJst();
const TO = single ?? arg("--to") ?? FROM;
const FORCE = args.includes("--force");
const VERIFY = args.includes("--verify");
const EXPORT_ROOT = "data/exports/odds-timeseries";
// 複製先は .env の BOAT_PON_EXPORT_MIRROR_DIR（シェルの環境変数が優先）。launchd のジョブは .env を自動では読まないので、ここで読む。
loadEnvFiles([".env"]);
const MIRROR = process.env.BOAT_PON_EXPORT_MIRROR_DIR?.trim() || null;
for (const d of [FROM, TO]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid date: ${d}`);

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
const query = db.prepare(`SELECT race_id, selection, odds, popularity, source, captured_at, minutes_before_close, checkpoint_label
  FROM odds_timeseries_snapshots WHERE race_id >= ? AND race_id < ? ORDER BY race_id, captured_at, selection`);

/** ファイルの中身が DB の行と完全に同じか（全列・重複も含めて）。読めない・古い形式なら false。 */
function matchesDb(gz: Buffer, expected: string): boolean {
  try {
    const captures = gunzipSync(gz).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as OddsTimeseriesCapture);
    if (captures.some((c) => !Array.isArray(c.rows))) return false;
    return canonicalOddsTimeseriesRows(expandOddsTimeseriesCaptures(captures)) === expected;
  } catch {
    return false;
  }
}

/** 一時ファイルに書き、確かめてから正式な名前にする（途中で止まっても、確かめていないファイルは正式な名前にならない）。 */
function writeVerified(path: string, content: Buffer, check: (written: Buffer) => boolean): boolean {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  if (!check(readFileSync(tmp))) {
    unlinkSync(tmp);
    return false;
  }
  renameSync(tmp, path);
  return true;
}

// 当日分は、収集が終わる 21:05 より後（21:10 以降）でないと書き出さない（途中の状態で固めないため）。--force でも外さない。
const jstNow = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const todayFinished = jstNow >= "21:10";
let written = 0, skipped = 0, rewritten = 0, empty = 0, mirrored = 0, verified = 0, notYet = 0, failed = 0;
try {
  for (let date = FROM; date <= TO; date = addDays(date, 1)) {
    if (date > todayJst() || (date === todayJst() && !todayFinished)) { notYet += 1; continue; }
    const relative = join(date.slice(0, 4), `${date}.jsonl.gz`);
    const path = join(EXPORT_ROOT, relative);
    const prefix = date.replaceAll("-", "");
    const rows = query.all(`${prefix}-`, `${prefix}.`) as OddsTimeseriesRow[];
    if (rows.length === 0) { empty += 1; continue; }
    const expected = canonicalOddsTimeseriesRows(rows);
    const exists = existsSync(path);
    // 既にあるファイルは、--verify のときだけ中身を確かめ、DB と違えば（古い形式を含む）書き直す。
    const needsWrite = !exists || FORCE || (VERIFY && !matchesDb(readFileSync(path), expected));
    if (needsWrite) {
      const content = gzipSync(`${groupOddsTimeseriesRows(rows).map((capture) => JSON.stringify(capture)).join("\n")}\n`);
      if (!writeVerified(path, content, (gz) => matchesDb(gz, expected))) {
        failed += 1;
        console.error(`export-odds-timeseries: ${date} の書き出しが DB と一致しない（書き出さなかった）`);
        continue;
      }
      if (exists) rewritten += 1; else written += 1;
    } else {
      skipped += 1;
    }
    if (VERIFY || needsWrite) verified += 1;
    if (MIRROR) {
      const target = join(MIRROR, "odds-timeseries", relative);
      const local = readFileSync(path);
      if (!existsSync(target) || !readFileSync(target).equals(local)) {
        if (writeVerified(target, local, (copy) => copy.equals(local))) mirrored += 1;
        else { failed += 1; console.error(`export-odds-timeseries: ${date} の複製が一致しない`); }
      }
    }
  }
} finally {
  db.close();
}
console.log(`export-odds-timeseries done: ${FROM}..${TO} written=${written} rewritten=${rewritten} skipped=${skipped} empty=${empty} verified=${verified} notYet=${notYet} failed=${failed} mirrored=${mirrored}${MIRROR ? "" : " (mirror: 未設定)"}`);
if (failed > 0) process.exitCode = 1;
