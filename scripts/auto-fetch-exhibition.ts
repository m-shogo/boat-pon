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

  // 展示タイム: Table 1 (headers: 枠|写真|ボートレーサー|体重|展示タイム|...)
  // 3行ごと構造: row0=[course,"","name","weight","exTime",...] row1=["進入",...] row2=[pre_st,"ST",...]
  const exhibitionTimeMap = new Map<number, number>();
  $("table").each((_i, table) => {
    const headerText = $(table).find("th").map((_, el) => $(el).text().trim()).get().join("|");
    if (!headerText.includes("展示タイム")) return;
    $(table).find("tbody tr").each((_j, tr) => {
      const cells = $(tr).find("th, td").map((_, el) => $(el).text().trim()).get();
      const course = Number(cells[0]);
      if (!Number.isInteger(course) || course < 1 || course > 6) return;
      const exTime = Number(cells[4]);
      if (Number.isFinite(exTime) && exTime >= 5 && exTime <= 10) {
        exhibitionTimeMap.set(course, exTime);
      }
    });
  });

  // スタート展示ST: Table 2 (headers: スタート展示|コース|並び|ST)
  // 各行が1セルで "course\n\n\t\t.XX" 形式
  const startTimingMap = new Map<number, number>();
  $("table").each((_i, table) => {
    const headerText = $(table).find("th").map((_, el) => $(el).text().trim()).get().join("|");
    if (!headerText.includes("スタート展示") && !headerText.includes("ST")) return;
    $(table).find("tbody tr").each((_j, tr) => {
      const cellText = $(tr).find("th, td").first().text().trim().replace(/\s+/g, " ");
      // "1 .18" や "2 .05" の形式
      const m = cellText.match(/^([1-6])\s+([.\-\d]+)$/);
      if (!m) return;
      const course = Number(m[1]);
      const stRaw = m[2].startsWith(".") ? "0" + m[2] : m[2];
      const st = Number(stRaw);
      if (Number.isFinite(st) && st > -1 && st < 1) {
        startTimingMap.set(course, st);
      }
    });
  });

  // コース1〜6でマージ
  const entries: ExhibitionEntry[] = [];
  for (let course = 1; course <= 6; course++) {
    const exTime = exhibitionTimeMap.get(course) ?? null;
    const st = startTimingMap.get(course) ?? null;
    if (exTime != null || st != null) {
      entries.push({ course, exhibitionTime: exTime, startTiming: st, ranking: null });
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
