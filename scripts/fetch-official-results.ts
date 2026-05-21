import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseOfficialResultsText } from "../src/domain/officialResultParser";
import { insertResult, openDb } from "../server/db";
import type { RaceResult } from "../src/domain/types";

const execFile = promisify(execFileCb);

const RAW_DIR = path.join("data", "raw", "official", "results");
const TMP_DIR = path.join("data", "tmp");
const SLEEP_MS = 1200;
const MAX_RANGE_DAYS = 400;

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    console.error("usage: tsx scripts/fetch-official-results.ts <YYYY-MM-DD> <YYYY-MM-DD>");
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
  const fetchedAt = new Date().toISOString();
  let totalRaces = 0;
  let skippedDays = 0;
  let failedDays = 0;

  try {
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const yymm = toYymm(date);
      const yymmdd = toYymmdd(date);
      const lzhPath = path.join(RAW_DIR, `k${yymmdd}.lzh`);
      const url = `https://www1.mbrace.or.jp/od2/K/${yymm}/k${yymmdd}.lzh`;

      const cached = existsSync(lzhPath);
      if (!cached) {
        try {
          await downloadFile(url, lzhPath);
        } catch (err) {
          failedDays += 1;
          console.warn(`fetch failed ${date}: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        if (i < dates.length - 1) await sleep(SLEEP_MS);
      } else {
        skippedDays += 1;
      }

      try {
        const text = await extractAndDecode(lzhPath, yymmdd);
        const results = parseOfficialResultsText(text, { date, fetchedAt });
        for (const row of results) insertResult(db, row);
        totalRaces += results.length;
        console.log(`${date}: ${results.length} races (${cached ? "cache" : "fetched"})`);
      } catch (err) {
        failedDays += 1;
        console.warn(`parse failed ${date}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    db.close();
  }

  console.log(`--- done: ${dates.length} days / ${totalRaces} races / cached=${skippedDays} / failed=${failedDays}`);
}

async function downloadFile(url: string, dest: string) {
  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency cache fetch" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function extractAndDecode(lzhPath: string, yymmdd: string): Promise<string> {
  const expectedTxt = path.join(TMP_DIR, `K${yymmdd.toUpperCase()}.TXT`);
  if (existsSync(expectedTxt)) await rm(expectedTxt);
  await execFile("unar", ["-q", "-o", TMP_DIR, "-f", lzhPath]);
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
