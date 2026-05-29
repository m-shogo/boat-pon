/**
 * 今日の候補レースの展示タイムと選手コース別勝率を自動取得しDBに保存する。
 *
 * cron / launchd で定期実行する想定（例: 毎30分）。
 * サーバー不要で単体動作する。
 *
 * usage:
 *   tsx scripts/auto-fetch-exhibition.ts [--dry-run]
 *
 *   --dry-run  DBに書かず対象レースだけ表示
 */

import * as cheerio from "cheerio";
import {
  getExhibitionData,
  getRacerCourseStatsFetchedAt,
  hasExhibitionData,
  listProgramInputs,
  openDb,
  upsertExhibitionData,
  upsertRacerCourseStats,
} from "../server/db";
import type { ExhibitionEntry, RacerCourseStat } from "../server/db";

const dryRun = process.argv.includes("--dry-run");

const RACER_STATS_TTL_DAYS = 7;
const FETCH_DELAY_MS = 1500;

const venueCodes: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
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

function parseExhibitionHtml(html: string): ExhibitionEntry[] {
  const $ = cheerio.load(html);
  const entries: ExhibitionEntry[] = [];

  $("table").each((_i, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text();
    if (!headerText.includes("展示タイム") && !headerText.includes("展示") && !headerText.includes("タイム")) return;

    const rows = $table.find("tbody tr").toArray();
    if (rows.length === 0) return;

    for (const tr of rows) {
      const cells = $(tr).find("th, td").toArray().map((el) => $(el).text().trim());
      if (cells.length < 2) continue;

      let course: number | null = null;
      let exhibitionTime: number | null = null;
      let startTiming: number | null = null;

      for (let ci = 0; ci < Math.min(cells.length, 3); ci++) {
        const val = Number(cells[ci]);
        if (Number.isInteger(val) && val >= 1 && val <= 6) {
          course = val;
          break;
        }
      }
      if (course == null) continue;

      for (const cell of cells) {
        const cleaned = cell.replace(/[^\d.]/g, "");
        const val = Number(cleaned);
        if (Number.isFinite(val) && val >= 5 && val <= 10 && cleaned.includes(".")) {
          exhibitionTime = val;
          break;
        }
      }

      for (const cell of cells) {
        const cleaned = cell.trim().replace(/[^\d.\-]/g, "");
        const val = Number(cleaned);
        if (Number.isFinite(val) && Math.abs(val) < 2 && cleaned.length > 0 && cleaned !== cleaned.replace(".", "")) {
          if (val !== exhibitionTime) {
            startTiming = val;
            break;
          }
        }
      }

      entries.push({ course, exhibitionTime, startTiming, ranking: null });
    }
  });

  if (entries.length === 0) {
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

function parseRacerProfileHtml(html: string): RacerCourseStat[] {
  const $ = cheerio.load(html);
  const stats: RacerCourseStat[] = [];

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
      stats.push({ course, races, wins, winRate, avgSt: parseAvgSt(html) });
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
      stats.push({ course: courseVal, races, wins, winRate, avgSt: parseAvgSt(html) });
    }
  }

  return stats;
}

function parseAvgSt(html: string): number | null {
  const $ = cheerio.load(html);
  let avgSt: number | null = null;
  $("table").each((_i, table) => {
    if (avgSt != null) return;
    const $table = $(table);
    if (!$table.find("th, thead").text().includes("ST")) return;
    $table.find("td, th").each((_j, el) => {
      if (avgSt != null) return;
      const v = Number($(el).text().trim());
      if (Number.isFinite(v) && v > 0 && v < 1) avgSt = v;
    });
  });
  if (avgSt != null) return avgSt;
  const text = $.root().text();
  const m = text.match(/平均ST[^\d]*(0\.\d{2})/);
  return m ? Number(m[1]) : null;
}

const db = openDb();
try {
  const today = todayJst();
  const now = new Date();
  const programs = listProgramInputs(db, today);

  let exhibitionFetched = 0;
  let exhibitionSkipped = 0;
  let racerFetched = 0;
  let racerSkipped = 0;
  let failed = 0;

  // --- 展示タイム ---
  for (const program of programs) {
    // レース締切後はスキップ
    const closeAtMs = new Date(`${program.date}T${program.closeAt}+09:00`).getTime();
    if (closeAtMs < now.getTime()) {
      exhibitionSkipped += 1;
      continue;
    }

    const raceId = program.raceId;
    if (hasExhibitionData(db, raceId)) {
      exhibitionSkipped += 1;
      continue;
    }

    const jcd = venueCodes[program.venue];
    if (!jcd) {
      console.warn(`unknown venue: ${program.venue}`);
      exhibitionSkipped += 1;
      continue;
    }

    const hd = program.date.replaceAll("-", "");
    const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${program.raceNo}&jcd=${jcd}&hd=${hd}`;

    if (dryRun) {
      console.log(`[dry-run] exhibition: ${raceId}`);
      exhibitionFetched += 1;
      continue;
    }

    try {
      await sleep(FETCH_DELAY_MS);
      const html = await fetchHtml(url);
      const entries = parseExhibitionHtml(html);
      if (entries.length > 0) {
        upsertExhibitionData(db, raceId, entries, new Date().toISOString());
        console.log(`exhibition: ${raceId} entries=${entries.length}`);
        exhibitionFetched += 1;
      } else {
        console.log(`exhibition-empty: ${raceId} (beforeinfo未公開の可能性)`);
        exhibitionSkipped += 1;
      }
    } catch (err) {
      console.error(`exhibition-error: ${raceId}`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  // --- 選手コース別勝率 ---
  const seenRegistrationNos = new Set<string>();
  for (const program of programs) {
    const boats = program.features?.boats ?? [];
    for (const boat of boats) {
      if (!boat.registrationNo) continue;
      if (seenRegistrationNos.has(boat.registrationNo)) continue;
      seenRegistrationNos.add(boat.registrationNo);

      const fetchedAt = getRacerCourseStatsFetchedAt(db, boat.registrationNo);
      if (!isStale(fetchedAt, RACER_STATS_TTL_DAYS)) {
        racerSkipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] racer-stats: ${boat.registrationNo} (${boat.racerName ?? ""})`);
        racerFetched += 1;
        continue;
      }

      const url = `https://www.boatrace.jp/owpc/pc/data/racerprofile?toban=${boat.registrationNo}`;
      try {
        await sleep(FETCH_DELAY_MS);
        const html = await fetchHtml(url);
        const stats = parseRacerProfileHtml(html);
        if (stats.length > 0) {
          upsertRacerCourseStats(db, boat.registrationNo, stats, new Date().toISOString());
          console.log(`racer-stats: ${boat.registrationNo} ${boat.racerName ?? ""} courses=${stats.length}`);
          racerFetched += 1;
        } else {
          console.warn(`racer-stats-empty: ${boat.registrationNo}`);
          racerSkipped += 1;
        }
      } catch (err) {
        console.error(`racer-stats-error: ${boat.registrationNo}`, err instanceof Error ? err.message : err);
        failed += 1;
      }
    }
  }

  console.log(
    `auto-fetch-exhibition done: exhibition fetched=${exhibitionFetched} skipped=${exhibitionSkipped} ` +
    `racer fetched=${racerFetched} skipped=${racerSkipped} failed=${failed} dryRun=${dryRun}`,
  );
} finally {
  db.close();
}
