/**
 * 今日の候補レースの公式直前情報を自動取得しDBに保存する。
 *
 * cron / launchd で定期実行する想定（例: 毎30分）。
 * 選手コース別成績の取得は bulk-fetch-racer-stats.ts が担う。
 *
 * usage:
 *   tsx scripts/auto-fetch-exhibition.ts [--dry-run] [--date YYYY-MM-DD] [--max N]
 */

import { hasBeforeInfoData, listProgramInputs, openDb } from "../server/db";
import { venueCodes } from "./fetch-official-odds";
import { fetchAndSaveBeforeInfo } from "./lib/beforeInfo";

const dryRun = process.argv.includes("--dry-run");
const FETCH_DELAY_MS = 1500;
const FETCH_FROM_MINUTES_BEFORE_CLOSE = 60;
const FETCH_UNTIL_MINUTES_AFTER_CLOSE = 360;
const DEFAULT_MAX_FETCHES = 80;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logError(message: string, detail: unknown) {
  console.error(`[${new Date().toISOString()}] ${message}`, detail);
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function numberArg(name: string, fallback: number): number {
  const value = argValue(name);
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.trunc(num);
}

const db = openDb();
try {
  const today = todayJst();
  const targetDate = argValue("--date") ?? today;
  const maxFetches = numberArg("--max", DEFAULT_MAX_FETCHES);
  const now = new Date();
  const programs = listProgramInputs(db, targetDate)
    .map((program) => {
      const closeAtMs = new Date(`${program.date}T${program.closeAt}+09:00`).getTime();
      return {
        ...program,
        closeAtMs,
        minutesUntilClose: Math.floor((closeAtMs - now.getTime()) / 60_000),
      };
    })
    .sort((a, b) => {
      const aAbs = Math.abs(a.minutesUntilClose);
      const bAbs = Math.abs(b.minutesUntilClose);
      return aAbs - bAbs || a.closeAtMs - b.closeAtMs || a.venue.localeCompare(b.venue) || a.raceNo - b.raceNo;
    });

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let tooEarly = 0;
  let tooLate = 0;
  let limited = 0;

  for (const program of programs) {
    if (hasBeforeInfoData(db, program.raceId)) { skipped += 1; continue; }
    if (fetched >= maxFetches) { limited += 1; skipped += 1; continue; }
    const minutesUntilClose = program.minutesUntilClose;
    if (minutesUntilClose > FETCH_FROM_MINUTES_BEFORE_CLOSE) { tooEarly += 1; skipped += 1; continue; }
    if (minutesUntilClose < -FETCH_UNTIL_MINUTES_AFTER_CLOSE) { tooLate += 1; skipped += 1; continue; }

    const jcd = venueCodes[program.venue];
    if (!jcd) { skipped += 1; continue; }

    if (dryRun) {
      log(`[dry-run] beforeinfo: ${program.raceId} closeIn=${minutesUntilClose}m`);
      fetched += 1;
      continue;
    }

    try {
      await sleep(FETCH_DELAY_MS);
      const result = await fetchAndSaveBeforeInfo(db, program);
      if (result.status === "saved") {
        log(`beforeinfo: ${program.raceId} entries=${result.entries} equipment=${result.equipment} closeIn=${minutesUntilClose}m${result.windSpeedMps != null || result.waveHeightCm != null ? ` wind=${result.windSpeedMps ?? "-"}m/s wave=${result.waveHeightCm ?? "-"}cm` : ""}`);
        fetched += 1;
      } else {
        log(`beforeinfo-empty: ${program.raceId} closeIn=${minutesUntilClose}m`);
        skipped += 1;
      }
    } catch (err) {
      logError(`beforeinfo-error: ${program.raceId} closeIn=${minutesUntilClose}m`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  log(`auto-fetch-exhibition done: date=${targetDate} fetched=${fetched} skipped=${skipped} tooEarly=${tooEarly} tooLate=${tooLate} limited=${limited} failed=${failed} dryRun=${dryRun}`);
} finally {
  db.close();
}
