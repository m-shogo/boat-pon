/**
 * 過去番組に登場した全選手のコース別成績・期別成績を一括取得してDBに保存する。
 *
 * 取得元:
 *   コース別: https://www.boatrace.jp/owpc/pc/data/racersearch/course?toban=XXXX
 *   期別:     https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=XXXX
 *
 * 期別成績の集計期間は半年ごとにリセットされるため、定期的に再取得が必要。
 *
 * usage:
 *   tsx scripts/bulk-fetch-racer-stats.ts [--dry-run] [--force]
 */

import * as cheerio from "cheerio";
import {
  getRacerLastFetchedAt,
  listAllRegistrationNos,
  openDb,
  upsertRacerCourseStats,
  upsertRacerProfile,
} from "../server/db";
import type { RacerCourseStat, RacerProfile } from "../server/db";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const FETCH_DELAY_MS = 1500;
const RACER_STATS_TTL_DAYS = 7;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isStale(fetchedAt: string | null, ttlDays: number): boolean {
  if (fetchedAt == null) return true;
  return Date.now() - new Date(fetchedAt).getTime() > ttlDays * 86400_000;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function parsePercent(text: string): number | null {
  const v = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseNum(text: string): number | null {
  const v = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? v : null;
}

/** racersearch/course ページからコース別成績を取得 */
function parseCourseHtml(html: string): RacerCourseStat[] {
  const $ = cheerio.load(html);
  const byCourse = new Map<number, Partial<RacerCourseStat>>();

  $("table").each((_i, table) => {
    const $table = $(table);
    const header = $table.find("th, thead").first().text().trim();

    const rows = $table.find("tbody tr, tr").toArray();
    for (const tr of rows) {
      const cells = $(tr).find("td, th").toArray().map((el) => $(el).text().trim());
      if (cells.length < 2) continue;
      const courseVal = Number(cells[0]);
      if (!Number.isInteger(courseVal) || courseVal < 1 || courseVal > 6) continue;

      if (!byCourse.has(courseVal)) byCourse.set(courseVal, { course: courseVal, races: 0, wins: 0, winRate: null, entryRate: null, top3Rate: null, avgSt: null, startOrder: null });
      const stat = byCourse.get(courseVal)!;
      const val = cells[1];

      if (header.includes("進入率")) {
        stat.entryRate = parsePercent(val);
      } else if (header.includes("3連対率")) {
        stat.top3Rate = parsePercent(val);
      } else if (header.includes("平均スタート")) {
        stat.avgSt = parseNum(val);
      } else if (header.includes("スタート順")) {
        stat.startOrder = parseNum(val);
      }
    }
  });

  return [...byCourse.values()].map((s) => ({
    course: s.course!,
    races: s.races ?? 0,
    wins: s.wins ?? 0,
    winRate: s.winRate ?? null,
    entryRate: s.entryRate ?? null,
    top3Rate: s.top3Rate ?? null,
    avgSt: s.avgSt ?? null,
    startOrder: s.startOrder ?? null,
  })).sort((a, b) => a.course - b.course);
}

/** racersearch/season ページから期別成績を取得 */
function parseSeasonHtml(html: string): RacerProfile {
  const $ = cheerio.load(html);
  let flyingCount: number | null = null;
  let lateStartCount: number | null = null;
  let top3Rate: number | null = null;
  let avgSt: number | null = null;
  let abilityIndex: number | null = null;

  $("table tr").each((_i, tr) => {
    const cells = $(tr).find("td, th").toArray().map((el) => $(el).text().trim());
    for (let ci = 0; ci < cells.length - 1; ci++) {
      const label = cells[ci];
      const val = cells[ci + 1];
      if (label.includes("3連対率")) top3Rate = parsePercent(val);
      if (label.includes("平均スタート")) avgSt = parseNum(val);
      if (label.includes("フライング")) flyingCount = parseNum(val.replace(/回.*/, ""));
      if (label.includes("出遅れ")) lateStartCount = parseNum(val.replace(/回.*/, ""));
      if (label.includes("能力指数")) abilityIndex = parseNum(val);
    }
  });

  return { flyingCount, lateStartCount, top3Rate, avgSt, abilityIndex };
}

const db = openDb();
try {
  const allRacers = listAllRegistrationNos(db);
  console.log(`対象選手: ${allRacers.length}人`);

  if (dryRun) {
    for (const { registrationNo, racerName } of allRacers) {
      const fetchedAt = getRacerLastFetchedAt(db, registrationNo);
      if (force || isStale(fetchedAt, RACER_STATS_TTL_DAYS)) {
        console.log(`[dry-run] ${registrationNo} ${racerName}`);
      }
    }
    process.exit(0);
  }

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const { registrationNo, racerName } of allRacers) {
    if (!force) {
      const fetchedAt = getRacerLastFetchedAt(db, registrationNo);
      if (!isStale(fetchedAt, RACER_STATS_TTL_DAYS)) {
        skipped += 1;
        continue;
      }
    }

    const courseUrl = `https://www.boatrace.jp/owpc/pc/data/racersearch/course?toban=${registrationNo}`;
    const seasonUrl = `https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=${registrationNo}`;

    try {
      await sleep(FETCH_DELAY_MS);
      const [courseHtml, seasonHtml] = await Promise.all([
        fetchHtml(courseUrl),
        fetchHtml(seasonUrl),
      ]);

      const courseStats = parseCourseHtml(courseHtml);
      const profile = parseSeasonHtml(seasonHtml);
      const fetchedAt = new Date().toISOString();

      if (courseStats.length > 0) {
        upsertRacerCourseStats(db, registrationNo, courseStats, fetchedAt);
      }
      upsertRacerProfile(db, registrationNo, profile, fetchedAt);

      fetched += 1;
      if (fetched % 50 === 0 || fetched <= 5) {
        const sample = courseStats[0];
        console.log(`[${fetched}/${allRacers.length - skipped}] ${registrationNo} ${racerName} ST=${sample?.avgSt} F=${profile.flyingCount}`);
      }
    } catch (err) {
      console.error(`error: ${registrationNo} ${racerName}`, err instanceof Error ? err.message : err);
      failed += 1;
      await sleep(FETCH_DELAY_MS * 2);
    }
  }

  console.log(`完了: fetched=${fetched} skipped=${skipped} failed=${failed}`);
} finally {
  db.close();
}
