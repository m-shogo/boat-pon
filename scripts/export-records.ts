/**
 * 取り直せない記録（paper-live の判定・LINE の通知の記録・設定）を、毎晩1つのファイルに書き出す（DB は読み取り専用）。
 *
 * 公式サイトから取り直せるもの（番組・結果・払戻）と違い、判定と通知の記録は失うと戻らない。DB 全体（約 16 GB）の
 * バックアップは同じディスクにしか無いので、小さく書き出して Google Drive などに複製する（2026-10-15、ユーザーの要望「自動化して」）。
 *
 * 出力: data/exports/records/latest.jsonl.gz（毎晩書き直す）と、月の最初の回に data/exports/records/YYYY-MM.jsonl.gz（その月の控え。書き直さない）。
 * 1行 = {"table": テーブル名, "row": 行}。書いたら読み直して、テーブルごとの行数が DB と同じかを確かめてから置く。
 * 複製: .env の BOAT_PON_EXPORT_MIRROR_DIR があれば、その下の records/ にも置く。
 */
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadEnvFiles } from "../src/domain/envFile";
import { todayJst } from "./lib/marketCaptures";

const ROOT = "data/exports/records";
loadEnvFiles([".env"]);
const MIRROR = process.env.BOAT_PON_EXPORT_MIRROR_DIR?.trim() || null;

// 取り直せないものだけ（判定は paper-live だけ。過去の研究用の行は除く）
const TABLES: Array<{ table: string; where: string }> = [
  { table: "decision_history", where: "run_kind = 'paper-live'" },
  { table: "notification_log", where: "1 = 1" },
  { table: "app_settings", where: "1 = 1" },
];

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
const counts = new Map<string, number>();
const lines: string[] = [];
try {
  for (const { table, where } of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all() as Array<Record<string, unknown>>;
    counts.set(table, rows.length);
    for (const row of rows) lines.push(JSON.stringify({ table, row }));
  }
} finally {
  db.close();
}
const content = gzipSync(`${lines.join("\n")}\n`);

/** 読み直して、テーブルごとの行数が DB と同じか。 */
function verify(gz: Buffer): boolean {
  try {
    const got = new Map<string, number>();
    for (const line of gunzipSync(gz).toString("utf8").split("\n")) {
      if (!line) continue;
      const { table } = JSON.parse(line) as { table: string };
      got.set(table, (got.get(table) ?? 0) + 1);
    }
    return [...counts].every(([table, n]) => (got.get(table) ?? 0) === n);
  } catch {
    return false;
  }
}

/** 一時ファイルに書いて確かめてから置く。exclusive なら、既にあるときは置かない（月の控えを書き直さない）。 */
function place(path: string, data: Buffer, exclusive: boolean): "written" | "exists" | "failed" {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  try {
    if (!verify(readFileSync(tmp))) return "failed";
    if (exclusive) {
      try { linkSync(tmp, path); } catch (err) { if ((err as NodeJS.ErrnoException).code === "EEXIST") return "exists"; throw err; }
      return "written";
    }
    renameSync(tmp, path);
    return "written";
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

const month = todayJst().slice(0, 7);
const results: string[] = [];
let failed = 0;
for (const [relative, exclusive] of [["latest.jsonl.gz", false], [`${month}.jsonl.gz`, true]] as const) {
  const local = place(join(ROOT, relative), content, exclusive);
  if (local === "failed") failed += 1;
  results.push(`${relative}=${local}`);
  if (MIRROR && local !== "failed") {
    const localBytes = readFileSync(join(ROOT, relative));
    const target = join(MIRROR, "records", relative);
    if (!existsSync(target) || !readFileSync(target).equals(localBytes)) {
      const mirrored = place(target, localBytes, false);
      if (mirrored === "failed") failed += 1;
      results.push(`mirror:${relative}=${mirrored}`);
    }
  }
}
console.log(`export-records done: ${[...counts].map(([t, n]) => `${t}=${n}`).join(" ")} ${results.join(" ")}${MIRROR ? "" : " (mirror: 未設定)"}`);
if (failed > 0) process.exitCode = 1;
