/**
 * 未取得日リストを出力する。
 * data/fetch-pending-k.txt: race_results に入っていない日付
 * data/fetch-pending-b.txt: official_programs に入っていない日付
 *
 * usage: tsx scripts/list-pending-dates.ts [from] [to]
 *   from/to 省略時は 2004-06-01 〜 2025-11-20 をデフォルトとする。
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { openDb } from "../server/db";

const DEFAULT_FROM = "2004-06-01";
const DEFAULT_TO = "2025-11-20";

async function main() {
  const from = process.argv[2] ?? DEFAULT_FROM;
  const to = process.argv[3] ?? DEFAULT_TO;
  const dates = enumerateDates(from, to);
  if (dates.length === 0) {
    console.error("invalid date range");
    process.exit(1);
  }

  const db = openDb();
  try {
    const kRows = db.prepare("SELECT DISTINCT date FROM race_results WHERE source='official'").all() as Array<{ date: string }>;
    const bRows = db.prepare("SELECT DISTINCT date FROM official_programs").all() as Array<{ date: string }>;
    const kSet = new Set(kRows.map((r) => r.date));
    const bSet = new Set(bRows.map((r) => r.date));

    const pendingK = dates.filter((d) => !kSet.has(d));
    const pendingB = dates.filter((d) => !bSet.has(d));

    const outK = path.join("data", "fetch-pending-k.txt");
    const outB = path.join("data", "fetch-pending-b.txt");
    await writeFile(outK, pendingK.join("\n") + "\n", "utf8");
    await writeFile(outB, pendingB.join("\n") + "\n", "utf8");

    console.log(`期間: ${from} 〜 ${to} (${dates.length}日)`);
    console.log(`K (競走成績) 取得済: ${kSet.size}日 / 未取得: ${pendingK.length}日 → ${outK}`);
    console.log(`B (番組表)   取得済: ${bSet.size}日 / 未取得: ${pendingB.length}日 → ${outB}`);
  } finally {
    db.close();
  }
}

function enumerateDates(from: string, to: string): string[] {
  const fromDate = new Date(`${from}T00:00:00+09:00`);
  const toDate = new Date(`${to}T00:00:00+09:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return [];
  if (fromDate > toDate) return [];
  const result: string[] = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    result.push(new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(d));
  }
  return result;
}

await main();
