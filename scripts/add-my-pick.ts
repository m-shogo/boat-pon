/**
 * あなたの予想を締切前に記録する（2026-11-19〜。用途: 精度。購入の指示ではない）。
 * 使い方: npx tsx scripts/add-my-pick.ts --venue 大村 --race 5 --pick "1-2-3,1-3-2" [--date YYYY-MM-DD] [--note "イン逃げ"]
 * 締切の時刻を過ぎたものは記録しない（成績は行動できた時点で数える）。DB は読むだけ。台帳は data/my-picks/picks.jsonl に 1 行ずつ足す。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseSelections, recordedBeforeClose, type MyPick } from "../src/domain/myPicks";
import { todayJst } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const venue = arg("--venue"), raceNo = Number(arg("--race")), date = arg("--date") ?? todayJst();
if (!venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) throw new Error("--venue（例: 大村）と --race（1〜12）が要る");
const selections = parseSelections(arg("--pick") ?? "");
const raceId = `${date.replaceAll("-", "")}-${venue}-${String(raceNo).padStart(2, "0")}`;
const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
const program = db.prepare("SELECT close_at FROM official_programs WHERE race_id = ?").get(raceId) as { close_at: string } | undefined;
db.close();
if (!program) throw new Error(`番組表に無いレース: ${raceId}`);
const recordedAt = new Date().toISOString();
if (!recordedBeforeClose(recordedAt, date, program.close_at)) throw new Error(`締切（${program.close_at}）を過ぎているので記録しない: ${raceId}`);
mkdirSync("data/my-picks", { recursive: true });
for (const selection of selections) {
  const row: MyPick = { raceId, selection, recordedAt, closeAt: program.close_at, ...(arg("--note") ? { note: arg("--note") } : {}) };
  appendFileSync("data/my-picks/picks.jsonl", `${JSON.stringify(row)}\n`);
}
console.log(`記録した: ${raceId}（締切 ${program.close_at}）${selections.join(" ")}`);
