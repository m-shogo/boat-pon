/**
 * 今日の候補レースの展示タイムを自動取得しDBに保存する。
 *
 * cron / launchd で定期実行する想定（例: 毎30分）。
 * 選手コース別成績の取得は bulk-fetch-racer-stats.ts が担う。
 *
 * usage:
 *   tsx scripts/auto-fetch-exhibition.ts [--dry-run]
 */

import * as cheerio from "cheerio";
import {
  hasExhibitionData,
  listProgramInputs,
  openDb,
  upsertExhibitionData,
} from "../server/db";
import type { ExhibitionEntry } from "../server/db";

const dryRun = process.argv.includes("--dry-run");
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

    for (const tr of $table.find("tbody tr").toArray()) {
      const cells = $(tr).find("th, td").toArray().map((el) => $(el).text().trim());
      if (cells.length < 2) continue;

      let course: number | null = null;
      for (let ci = 0; ci < Math.min(cells.length, 3); ci++) {
        const val = Number(cells[ci]);
        if (Number.isInteger(val) && val >= 1 && val <= 6) { course = val; break; }
      }
      if (course == null) continue;

      let exhibitionTime: number | null = null;
      for (const cell of cells) {
        const cleaned = cell.replace(/[^\d.]/g, "");
        const val = Number(cleaned);
        if (Number.isFinite(val) && val >= 5 && val <= 10 && cleaned.includes(".")) {
          exhibitionTime = val; break;
        }
      }

      let startTiming: number | null = null;
      for (const cell of cells) {
        const cleaned = cell.trim().replace(/[^\d.\-]/g, "");
        const val = Number(cleaned);
        if (Number.isFinite(val) && Math.abs(val) < 2 && cleaned.includes(".") && val !== exhibitionTime) {
          startTiming = val; break;
        }
      }

      entries.push({ course, exhibitionTime, startTiming, ranking: null });
    }
  });

  if (entries.length === 0) {
    for (const line of $.root().text().split(/\n/).map((l) => l.trim()).filter(Boolean)) {
      const m = line.match(/^([1-6])\s/);
      if (!m) continue;
      const course = Number(m[1]);
      const timeMatch = line.match(/([5-9]\.\d{2})/);
      const stMatch = line.match(/([-]?\d\.\d{2})/);
      entries.push({
        course,
        exhibitionTime: timeMatch ? Number(timeMatch[1]) : null,
        startTiming: stMatch ? Number(stMatch[1]) : null,
        ranking: null,
      });
    }
  }

  return entries;
}

const db = openDb();
try {
  const today = todayJst();
  const now = new Date();
  const programs = listProgramInputs(db, today);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const program of programs) {
    const closeAtMs = new Date(`${program.date}T${program.closeAt}+09:00`).getTime();
    if (closeAtMs < now.getTime()) { skipped += 1; continue; }
    if (hasExhibitionData(db, program.raceId)) { skipped += 1; continue; }

    const jcd = venueCodes[program.venue];
    if (!jcd) { skipped += 1; continue; }

    if (dryRun) {
      console.log(`[dry-run] exhibition: ${program.raceId}`);
      fetched += 1;
      continue;
    }

    const hd = program.date.replaceAll("-", "");
    const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${program.raceNo}&jcd=${jcd}&hd=${hd}`;

    try {
      await sleep(FETCH_DELAY_MS);
      const html = await fetchHtml(url);
      const entries = parseExhibitionHtml(html);
      if (entries.length > 0) {
        upsertExhibitionData(db, program.raceId, entries, new Date().toISOString());
        console.log(`exhibition: ${program.raceId} entries=${entries.length}`);
        fetched += 1;
      } else {
        console.log(`exhibition-empty: ${program.raceId}`);
        skipped += 1;
      }
    } catch (err) {
      console.error(`exhibition-error: ${program.raceId}`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  console.log(`auto-fetch-exhibition done: fetched=${fetched} skipped=${skipped} failed=${failed} dryRun=${dryRun}`);
} finally {
  db.close();
}
