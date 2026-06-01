/**
 * 公式直前情報から展示タイム・水面気象・チルト/部品交換を取得しDBに保存する。
 *
 * usage: tsx scripts/fetch-exhibition.ts <YYYY-MM-DD> <venue> <raceNo>
 *
 * 例: tsx scripts/fetch-exhibition.ts 2026-05-29 鳴門 3
 */

import { openDb, upsertExhibitionData, upsertRaceEquipment, upsertRaceWeather } from "../server/db";
import { parseBeforeInfoHtml, parseExhibitionHtml, parseWeatherHtml } from "../src/domain/beforeInfoParser";

export { parseExhibitionHtml, parseWeatherHtml };

const venueCodes: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

async function main() {
  const [date, venue, raceNoStr] = process.argv.slice(2);
  if (!date || !venue || !raceNoStr) {
    console.error("usage: tsx scripts/fetch-exhibition.ts <YYYY-MM-DD> <venue> <raceNo>");
    process.exit(1);
  }

  const jcd = venueCodes[venue];
  if (!jcd) {
    console.error(`unknown venue: ${venue}`);
    process.exit(1);
  }

  const raceNo = Number(raceNoStr);
  if (!Number.isFinite(raceNo) || raceNo < 1 || raceNo > 12) {
    console.error(`invalid raceNo: ${raceNoStr}`);
    process.exit(1);
  }

  const hd = date.replaceAll("-", "");
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${raceNo}&jcd=${jcd}&hd=${hd}`;

  console.log(`fetching: ${url}`);
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" },
  });
  if (!res.ok) {
    console.error(`fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  const { exhibition: entries, weather, equipment } = parseBeforeInfoHtml(html);
  if (entries.length === 0) {
    console.warn("no exhibition data found in HTML");
  } else {
    console.log(`parsed ${entries.length} entries`);
    for (const entry of entries) {
      console.log(`  course=${entry.course} time=${entry.exhibitionTime} ST=${entry.startTiming}`);
    }
  }
  if (weather) {
    console.log(`weather: ${weather.weather ?? "-"} wind=${weather.windSpeedMps ?? "-"}m/s wave=${weather.waveHeightCm ?? "-"}cm stablePlate=${weather.stablePlate ?? false}`);
  }
  if (equipment.length > 0) {
    console.log(`equipment: entries=${equipment.length} partsChanged=${equipment.filter((entry) => entry.partsChangedCount > 0).length}`);
  }

  const raceId = `${hd}-${venue}-${String(raceNo).padStart(2, "0")}`;
  const fetchedAt = new Date().toISOString();
  const db = openDb();
  try {
    upsertExhibitionData(db, raceId, entries, fetchedAt);
    if (weather) upsertRaceWeather(db, raceId, weather, fetchedAt);
    upsertRaceEquipment(db, raceId, equipment, fetchedAt);
    console.log(`saved: ${raceId} entries=${entries.length} equipment=${equipment.length}`);
  } finally {
    db.close();
  }
}

// このファイルを直接実行したときだけ main() を呼ぶ。
// import { parseWeatherHtml } from "./fetch-exhibition" で読み込んだときは呼ばない。
if (process.argv[1]?.endsWith("/fetch-exhibition.ts") || process.argv[1]?.endsWith("/fetch-exhibition.js")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
