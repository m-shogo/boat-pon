/**
 * 選手コース別勝率を公式サイトから取得しDBに保存する。
 *
 * usage: tsx scripts/fetch-racer-course-stats.ts <registrationNo>
 *
 * 例: tsx scripts/fetch-racer-course-stats.ts 4444
 */

import * as cheerio from "cheerio";
import { openDb, upsertRacerCourseStats } from "../server/db";
import type { RacerCourseStat } from "../server/db";

function parseRacerProfileHtml(html: string): RacerCourseStat[] {
  const $ = cheerio.load(html);
  const stats: RacerCourseStat[] = [];

  // コース別成績テーブルを探す
  // 公式ページ: コース1〜6 それぞれの出走回数・1着回数・勝率が含まれる
  $("table").each((_i, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text();

    // コース別成績テーブルを識別
    const isCoursTable =
      headerText.includes("コース別") ||
      (headerText.includes("コース") && (headerText.includes("勝率") || headerText.includes("1着")));
    if (!isCoursTable) return;

    const headerCells = $table.find("thead tr").last().find("th").toArray().map((el) => $(el).text().trim());
    const bodyRows = $table.find("tbody tr").toArray();

    // ヘッダーからコース番号の列を特定
    for (const tr of bodyRows) {
      const cells = $(tr).find("th, td").toArray().map((el) => $(el).text().trim());
      if (cells.length < 2) continue;

      // 先頭セルがコース番号（1〜6）かチェック
      const courseVal = Number(cells[0]);
      if (!Number.isInteger(courseVal) || courseVal < 1 || courseVal > 6) continue;

      const course = courseVal;
      let races = 0;
      let wins = 0;
      let winRate: number | null = null;

      // 残りのセルから出走回数・1着回数・勝率を推測
      const numericCells = cells.slice(1).map((c) => {
        const cleaned = c.replace(/[^\d.]/g, "");
        return cleaned ? Number(cleaned) : null;
      }).filter((v): v is number => v !== null && Number.isFinite(v));

      // 列の意味はヘッダーを参照して推測
      // 典型的な列順: コース, 出走, 1着, 2着, 3着, 4着, 5着, 6着, 勝率, ...
      if (headerCells.length > 0) {
        const racesIdx = headerCells.findIndex((h) => h.includes("出走") || h === "数");
        const winsIdx = headerCells.findIndex((h) => h === "1着" || h.includes("1着"));
        const winRateIdx = headerCells.findIndex((h) => h.includes("勝率"));

        const dataCells = cells.slice(1);
        if (racesIdx >= 0 && racesIdx < dataCells.length) {
          races = Number(dataCells[racesIdx].replace(/[^\d]/g, "")) || 0;
        }
        if (winsIdx >= 0 && winsIdx < dataCells.length) {
          wins = Number(dataCells[winsIdx].replace(/[^\d]/g, "")) || 0;
        }
        if (winRateIdx >= 0 && winRateIdx < dataCells.length) {
          const v = Number(dataCells[winRateIdx].replace(/[^\d.]/g, ""));
          winRate = Number.isFinite(v) ? v : null;
        }
      } else if (numericCells.length >= 2) {
        // ヘッダーが読み取れない場合: 最初の整数=出走, 2番目の整数=1着, 最初の小数=勝率
        for (const v of numericCells) {
          if (Number.isInteger(v) && races === 0) { races = v; continue; }
          if (Number.isInteger(v) && wins === 0) { wins = v; continue; }
          if (!Number.isInteger(v) && winRate == null) { winRate = v; break; }
        }
      }

      // 勝率が取れなかった場合は計算
      if (winRate == null && races > 0) {
        winRate = Math.round((wins / races) * 100) / 100;
      }

      stats.push({ course, races, wins, winRate });
    }
  });

  // テーブルが見つからない場合はフォールバック
  if (stats.length === 0) {
    // コース1〜6の行をページ全体のテキストから探す
    const allRows = $("tr").toArray();
    for (const tr of allRows) {
      const cells = $(tr).find("td, th").toArray().map((el) => $(el).text().trim());
      if (cells.length < 3) continue;
      const courseVal = Number(cells[0]);
      if (!Number.isInteger(courseVal) || courseVal < 1 || courseVal > 6) continue;

      const nums = cells.slice(1).map((c) => {
        const cleaned = c.replace(/[^\d.]/g, "");
        return cleaned ? Number(cleaned) : null;
      }).filter((v): v is number => v !== null && Number.isFinite(v));

      if (nums.length < 2) continue;
      const races = nums[0] || 0;
      const wins = nums[1] || 0;
      const winRate = nums.find((v) => !Number.isInteger(v)) ?? (races > 0 ? Math.round((wins / races) * 100) / 100 : null);
      stats.push({ course: courseVal, races, wins, winRate });
    }
  }

  return stats;
}

async function main() {
  const [registrationNo] = process.argv.slice(2);
  if (!registrationNo) {
    console.error("usage: tsx scripts/fetch-racer-course-stats.ts <registrationNo>");
    process.exit(1);
  }

  const url = `https://www.boatrace.jp/owpc/pc/data/racerprofile?toban=${registrationNo}`;

  console.log(`fetching: ${url}`);
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" },
  });
  if (!res.ok) {
    console.error(`fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  const stats = parseRacerProfileHtml(html);
  if (stats.length === 0) {
    console.warn("no course stats found in HTML");
  } else {
    console.log(`parsed ${stats.length} course stats`);
    for (const stat of stats) {
      console.log(`  course=${stat.course} races=${stat.races} wins=${stat.wins} winRate=${stat.winRate}`);
    }
  }

  const fetchedAt = new Date().toISOString();
  const db = openDb();
  try {
    upsertRacerCourseStats(db, registrationNo, stats, fetchedAt);
    console.log(`saved: registrationNo=${registrationNo} stats=${stats.length}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
