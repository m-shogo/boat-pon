/**
 * 展示タイム・スタートタイミングを公式サイトから取得しDBに保存する。
 *
 * usage: tsx scripts/fetch-exhibition.ts <YYYY-MM-DD> <venue> <raceNo>
 *
 * 例: tsx scripts/fetch-exhibition.ts 2026-05-29 鳴門 3
 */

import * as cheerio from "cheerio";
import { openDb, upsertExhibitionData } from "../server/db";
import type { ExhibitionEntry } from "../server/db";

const venueCodes: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

function parseExhibitionHtml(html: string): ExhibitionEntry[] {
  const $ = cheerio.load(html);
  const entries: ExhibitionEntry[] = [];

  // 公式サイトの beforeinfo ページのテーブルから展示タイム・STを抽出
  // テーブル構造: 各行が1艇のデータ
  // コース番号、選手名、展示タイム、ST（スタートタイミング）、順位などが含まれる

  // 展示タイムが含まれるテーブルを探す
  $("table").each((_i, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text();
    // 展示タイムのテーブルを識別
    if (!headerText.includes("展示タイム") && !headerText.includes("展示") && !headerText.includes("タイム")) return;

    const rows = $table.find("tbody tr").toArray();
    if (rows.length === 0) return;

    for (const tr of rows) {
      const cells = $(tr).find("th, td").toArray().map((el) => $(el).text().trim());
      if (cells.length < 2) continue;

      // コース番号を探す（1〜6の整数）
      let course: number | null = null;
      let exhibitionTime: number | null = null;
      let startTiming: number | null = null;

      // 最初の数値セルをコース番号として扱う
      for (let ci = 0; ci < Math.min(cells.length, 3); ci++) {
        const val = Number(cells[ci]);
        if (Number.isInteger(val) && val >= 1 && val <= 6) {
          course = val;
          break;
        }
      }
      if (course == null) continue;

      // 展示タイムの候補: "6.82" のような小数点付き数値
      for (const cell of cells) {
        const cleaned = cell.replace(/[^\d.]/g, "");
        const val = Number(cleaned);
        if (Number.isFinite(val) && val >= 5 && val <= 10 && cleaned.includes(".")) {
          exhibitionTime = val;
          break;
        }
      }

      // スタートタイミングの候補: "0.19" や "-0.01" のような数値
      for (const cell of cells) {
        const cleaned = cell.trim().replace(/[^\d.\-]/g, "");
        const val = Number(cleaned);
        if (Number.isFinite(val) && Math.abs(val) < 2 && cleaned.length > 0 && cleaned !== cleaned.replace(".", "")) {
          // exhibitionTimeと異なる値を探す
          if (val !== exhibitionTime) {
            startTiming = val;
            break;
          }
        }
      }

      entries.push({ course, exhibitionTime, startTiming, ranking: null });
    }
  });

  // テーブルが見つからない場合はフォールバック: 各行のテキストを解析
  if (entries.length === 0) {
    // 展示タイムらしいパターンを全行から探す
    const allText = $.root().text();
    const lines = allText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const courseMatch = line.match(/^([1-6])\s/);
      if (!courseMatch) continue;
      const course = Number(courseMatch[1]);
      const timeMatch = line.match(/([5-9]\.\d{2})/);
      const stMatch = line.match(/([-]?\d\.\d{2})/);
      const exhibitionTime = timeMatch ? Number(timeMatch[1]) : null;
      const startTiming = stMatch ? Number(stMatch[1]) : null;
      entries.push({ course, exhibitionTime, startTiming, ranking: null });
    }
  }

  return entries;
}

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
  const entries = parseExhibitionHtml(html);
  if (entries.length === 0) {
    console.warn("no exhibition data found in HTML");
  } else {
    console.log(`parsed ${entries.length} entries`);
    for (const entry of entries) {
      console.log(`  course=${entry.course} time=${entry.exhibitionTime} ST=${entry.startTiming}`);
    }
  }

  const raceId = `${hd}-${venue}-${String(raceNo).padStart(2, "0")}`;
  const fetchedAt = new Date().toISOString();
  const db = openDb();
  try {
    upsertExhibitionData(db, raceId, entries, fetchedAt);
    console.log(`saved: ${raceId} entries=${entries.length}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
