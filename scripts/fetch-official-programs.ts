import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseOfficialProgramsText } from "../src/domain/officialProgramParser";
import {
  parseForcedProgramRefreshDates,
  shouldSkipOfficialProgramDate,
  summarizeOfficialProgramDayInventory,
} from "../src/domain/officialProgramRefreshPolicy";
import { insertOfficialProgram, openDb } from "../server/db";

const execFile = promisify(execFileCb);

const RAW_DIR = path.join("data", "raw", "official", "programs");
const TMP_DIR = path.join("data", "tmp", "programs");
const SLEEP_MS = 1500;
const FETCH_RETRY_COUNT = 2;
const FETCH_RETRY_DELAY_MS = 3000;
const MAX_RANGE_DAYS = 10000;
const DL_ONLY = process.env.BOAT_PON_DL_ONLY === "1";
const SKIP_EXISTING = process.env.BOAT_PON_SKIP_EXISTING === "1";
const FORCED_REFRESH_DATES = parseForcedProgramRefreshDates(
  process.env.BOAT_PON_FORCE_PROGRAM_REFRESH_DATES,
);

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    console.error("usage: tsx scripts/fetch-official-programs.ts <YYYY-MM-DD> <YYYY-MM-DD>");
    process.exit(1);
  }
  const dates = enumerateDates(fromArg, toArg);
  if (dates.length === 0) {
    console.error("invalid date range");
    process.exit(1);
  }
  if (dates.length > MAX_RANGE_DAYS) {
    console.error(`range too long: ${dates.length} days (max ${MAX_RANGE_DAYS})`);
    process.exit(1);
  }

  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  const db = openDb();
  let totalRows = 0;
  let skippedDays = 0;
  let alreadyHaveDays = 0;
  let refreshedDays = 0;
  let failedDays = 0;

  const existingDates = new Set<string>();
  if (SKIP_EXISTING) {
    const rows = db.prepare("SELECT DISTINCT date FROM official_programs").all() as Array<{ date: string }>;
    for (const row of rows) existingDates.add(row.date);
    console.log(`SKIP_EXISTING: ${existingDates.size}日分は既に取り込み済みです（強制refresh日は除外）`);
  }
  if (FORCED_REFRESH_DATES.size > 0) {
    console.log(`FORCE_REFRESH: ${[...FORCED_REFRESH_DATES].sort().join(",")}`);
  }

  try {
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const forceRefresh = FORCED_REFRESH_DATES.has(date);

      if (shouldSkipOfficialProgramDate({
        date,
        skipExisting: SKIP_EXISTING,
        existingDates,
        forcedRefreshDates: FORCED_REFRESH_DATES,
      })) {
        alreadyHaveDays += 1;
        continue;
      }

      const yymm = toYymm(date);
      const yymmdd = toYymmdd(date);
      const lzhPath = path.join(RAW_DIR, `b${yymmdd}.lzh`);
      const txtPath = extractedTextPath(yymmdd);
      const url = `https://www1.mbrace.or.jp/od2/B/${yymm}/b${yymmdd}.lzh`;
      const cached = existsSync(lzhPath);

      if (forceRefresh) {
        try {
          await replaceDownloadWithRetry(url, lzhPath);
          await rm(txtPath, { force: true });
          refreshedDays += 1;
        } catch (err) {
          failedDays += 1;
          console.warn(`forced refresh failed ${date}: ${err instanceof Error ? err.message : err}`);
          continue;
        }
      } else if (!cached) {
        try {
          await downloadFileWithRetry(url, lzhPath);
        } catch (err) {
          failedDays += 1;
          console.warn(`fetch failed ${date}: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        if (i < dates.length - 1) await sleep(SLEEP_MS);
      } else {
        skippedDays += 1;
      }

      if (DL_ONLY) {
        console.log(`${date}: ${forceRefresh ? "refreshed" : cached ? "cache" : "fetched"} (DL-only)`);
        continue;
      }

      try {
        const text = await extractAndDecode(lzhPath, yymmdd);
        const rows = parseOfficialProgramsText(text, { date });
        const inventory = summarizeOfficialProgramDayInventory(
          date,
          rows.map((row) => ({ date: row.date, venue: row.venue, raceNo: row.raceNo })),
        );
        if (!inventory.structurallyComplete) {
          failedDays += 1;
          console.warn(`${date}: structurally incomplete official program inventory ${JSON.stringify(inventory)}`);
          continue;
        }

        db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of rows) {
            const raceId = `${row.date.replaceAll("-", "")}-${row.venue}-${String(row.raceNo).padStart(2, "0")}`;
            insertOfficialProgram(db, {
              raceId,
              date: row.date,
              venue: row.venue,
              raceNo: row.raceNo,
              closeAt: row.closeAt,
              sourceFile: `b${yymmdd}.lzh`,
              raw: row,
            });
          }
          db.exec("COMMIT");
        } catch (error) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve original failure. */ }
          throw error;
        }

        totalRows += rows.length;
        existingDates.add(date);
        console.log(
          `${date}: ${rows.length} races / ${inventory.venueCount} venues (${forceRefresh ? "refreshed" : cached ? "cache" : "fetched"})`,
        );
      } catch (err) {
        failedDays += 1;
        console.warn(`parse/import failed ${date}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    db.close();
  }

  console.log(
    `--- done: ${dates.length} days / ${totalRows} programs / cached=${skippedDays} / already=${alreadyHaveDays} / refreshed=${refreshedDays} / failed=${failedDays}`,
  );
  if (failedDays > 0) process.exitCode = 1;
}

async function downloadFileWithRetry(url: string, dest: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_COUNT; attempt += 1) {
    try {
      await downloadFile(url, dest);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRY_COUNT) await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

async function replaceDownloadWithRetry(url: string, dest: string): Promise<void> {
  const temporary = `${dest}.${process.pid}.${Date.now()}.refresh.tmp`;
  try {
    await downloadFileWithRetry(url, temporary);
    await rename(temporary, dest);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function downloadFile(url: string, dest: string) {
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency cache fetch" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty response ${url}`);
  await writeFile(dest, buf);
}

function extractedTextPath(yymmdd: string): string {
  return path.join(TMP_DIR, `B${yymmdd.toUpperCase()}.TXT`);
}

async function extractAndDecode(lzhPath: string, yymmdd: string): Promise<string> {
  const expectedTxt = extractedTextPath(yymmdd);
  if (!existsSync(expectedTxt)) {
    await execFile("unar", ["-q", "-o", TMP_DIR, "-f", lzhPath]);
  }
  const buf = await readFile(expectedTxt);
  return new TextDecoder("shift_jis").decode(buf);
}

function enumerateDates(from: string, to: string): string[] {
  const fromDate = new Date(`${from}T00:00:00+09:00`);
  const toDate = new Date(`${to}T00:00:00+09:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return [];
  if (fromDate > toDate) return [];
  const result: string[] = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    result.push(formatYmd(d));
  }
  return result;
}

function formatYmd(d: Date): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(d);
}

function toYymm(ymd: string): string {
  return ymd.slice(0, 7).replace("-", "");
}

function toYymmdd(ymd: string): string {
  return ymd.slice(2).replaceAll("-", "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
