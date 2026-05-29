/**
 * 過去番組に登場した全選手のコース別勝率を一括取得してDBに保存する。
 *
 * 初回セットアップ用。通常運用は auto-fetch-exhibition.ts に任せる。
 *
 * usage:
 *   tsx scripts/bulk-fetch-racer-stats.ts [--dry-run] [--force]
 *
 *   --dry-run  DBに書かず対象選手数だけ表示
 *   --force    既存データがあっても再取得
 */

import * as cheerio from "cheerio";
import {
  getRacerCourseStatsFetchedAt,
  listAllRegistrationNos,
  openDb,
  upsertRacerCourseStats,
} from "../server/db";
import type { RacerCourseStat } from "../server/db";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const FETCH_DELAY_MS = 1500;
const RACER_STATS_TTL_DAYS = 7;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isStale(fetchedAt: string | null, ttlDays: number): boolean {
  if (fetchedAt == null) return true;
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > ttlDays * 86400_000;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function parseAvgSt(html: string): number | null {
  const $ = cheerio.load(html);
  // 平均STは「平均ST」ラベルの近くにある小数値（例: 0.15）
  let avgSt: number | null = null;
  $("table").each((_i, table) => {
    if (avgSt != null) return;
    const $table = $(table);
    const headerText = $table.find("th, thead").text();
    if (!headerText.includes("平均ST") && !headerText.includes("ST")) return;
    $table.find("td, th").each((_j, el) => {
      if (avgSt != null) return;
      const text = $(el).text().trim();
      const v = Number(text);
      if (Number.isFinite(v) && v > 0 && v < 1) avgSt = v;
    });
  });
  if (avgSt != null) return avgSt;
  // フォールバック: ページ全体から「平均ST」直後の数値を探す
  const text = $.root().text();
  const m = text.match(/平均ST[^\d]*(0\.\d{2})/);
  if (m) return Number(m[1]);
  return null;
}

function parseRacerProfileHtml(html: string): RacerCourseStat[] {
  const $ = cheerio.load(html);
  const stats: RacerCourseStat[] = [];
  const avgSt = parseAvgSt(html);

  $("table").each((_i, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text();
    const isCoursTable =
      headerText.includes("コース別") ||
      (headerText.includes("コース") && (headerText.includes("勝率") || headerText.includes("1着")));
    if (!isCoursTable) return;

    const headerCells = $table.find("thead tr").last().find("th").toArray().map((el) => $(el).text().trim());
    const bodyRows = $table.find("tbody tr").toArray();

    for (const tr of bodyRows) {
      const cells = $(tr).find("th, td").toArray().map((el) => $(el).text().trim());
      if (cells.length < 2) continue;
      const courseVal = Number(cells[0]);
      if (!Number.isInteger(courseVal) || courseVal < 1 || courseVal > 6) continue;

      const course = courseVal;
      let races = 0;
      let wins = 0;
      let winRate: number | null = null;

      if (headerCells.length > 0) {
        const racesIdx = headerCells.findIndex((h) => h.includes("出走") || h === "数");
        const winsIdx = headerCells.findIndex((h) => h === "1着" || h.includes("1着"));
        const winRateIdx = headerCells.findIndex((h) => h.includes("勝率"));
        const dataCells = cells.slice(1);
        if (racesIdx >= 0 && racesIdx < dataCells.length) races = Number(dataCells[racesIdx].replace(/[^\d]/g, "")) || 0;
        if (winsIdx >= 0 && winsIdx < dataCells.length) wins = Number(dataCells[winsIdx].replace(/[^\d]/g, "")) || 0;
        if (winRateIdx >= 0 && winRateIdx < dataCells.length) {
          const v = Number(dataCells[winRateIdx].replace(/[^\d.]/g, ""));
          winRate = Number.isFinite(v) ? v : null;
        }
      } else {
        const numericCells = cells.slice(1).map((c) => {
          const cleaned = c.replace(/[^\d.]/g, "");
          return cleaned ? Number(cleaned) : null;
        }).filter((v): v is number => v !== null && Number.isFinite(v));
        for (const v of numericCells) {
          if (Number.isInteger(v) && races === 0) { races = v; continue; }
          if (Number.isInteger(v) && wins === 0) { wins = v; continue; }
          if (!Number.isInteger(v) && winRate == null) { winRate = v; break; }
        }
      }

      if (winRate == null && races > 0) winRate = Math.round((wins / races) * 100) / 100;
      stats.push({ course, races, wins, winRate, avgSt });
    }
  });

  if (stats.length === 0) {
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

const db = openDb();
try {
  // SQL で全登録番号を直接抽出（メモリ効率）
  const allRacers = listAllRegistrationNos(db).map((r) => [r.registrationNo, r.racerName] as [string, string]);
  console.log(`対象選手: ${allRacers.length}人`);

  if (dryRun) {
    for (const [regNo, name] of allRacers) {
      const fetchedAt = getRacerCourseStatsFetchedAt(db, regNo);
      const stale = isStale(fetchedAt, RACER_STATS_TTL_DAYS);
      if (force || stale) {
        console.log(`[dry-run] ${regNo} ${name} fetchedAt=${fetchedAt ?? "未取得"}`);
      }
    }
    process.exit(0);
  }

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const [regNo, name] of allRacers) {
    if (!force) {
      const fetchedAt = getRacerCourseStatsFetchedAt(db, regNo);
      if (!isStale(fetchedAt, RACER_STATS_TTL_DAYS)) {
        skipped += 1;
        continue;
      }
    }

    const url = `https://www.boatrace.jp/owpc/pc/data/racerprofile?toban=${regNo}`;
    try {
      await sleep(FETCH_DELAY_MS);
      const html = await fetchHtml(url);
      const stats = parseRacerProfileHtml(html);
      if (stats.length > 0) {
        upsertRacerCourseStats(db, regNo, stats, new Date().toISOString());
        fetched += 1;
        if (fetched % 50 === 0) {
          console.log(`進捗: ${fetched}/${allRacers.length - skipped} 完了 (スキップ=${skipped} 失敗=${failed})`);
        }
      } else {
        console.warn(`empty: ${regNo} ${name}`);
        skipped += 1;
      }
    } catch (err) {
      console.error(`error: ${regNo} ${name}`, err instanceof Error ? err.message : err);
      failed += 1;
      await sleep(FETCH_DELAY_MS * 2);
    }
  }

  console.log(`完了: fetched=${fetched} skipped=${skipped} failed=${failed}`);
} finally {
  db.close();
}
