import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { RaceResult } from "../src/domain/types";
import { insertResult, openDb } from "../server/db";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const rawPath = path.join("data", "raw", "kyotei24", "results", `${date}.html`);
const normalizedDir = path.join("data", "normalized", "results");
const normalizedPath = path.join(normalizedDir, `${date}.json`);

if (!existsSync(rawPath)) {
  throw new Error(`raw file not found: ${rawPath}. Run npm run fetch:kyotei24 first.`);
}

const html = await readFile(rawPath, "utf8");
const fetchedAt = new Date().toISOString();
const results = parseKyotei24Results(html, date, fetchedAt);

await mkdir(normalizedDir, { recursive: true });
await writeFile(normalizedPath, JSON.stringify({ source: "kyotei24", date, fetchedAt, results }, null, 2), "utf8");

const db = openDb();
for (const result of results) {
  insertResult(db, result);
}
db.close();

console.log(`normalized ${results.length} results: ${normalizedPath}`);

export function parseKyotei24Results(html: string, date: string, fetchedAt: string): RaceResult[] {
  const $ = cheerio.load(html);
  const results: RaceResult[] = [];

  $("#tblKekkaK24 table").each((_, table) => {
    const venue = parseVenue($, table);
    if (!venue) return;

    $(table).find("tr.tds").each((__, row) => {
      const cells = $(row).children("td");
      if (cells.length < 4) return;

      const raceNo = Number(cells.eq(0).text().replace(/\D/g, ""));
      if (!raceNo) return;

      const boatNumbers = cells.eq(1).find(".rb div, .rb12 div").map((___, div) => $(div).text().trim()).get()
        .filter((value) => /^[1-6]$/.test(value));
      if (boatNumbers.length !== 3) return;

      const payoutText = cells.eq(2).text().replace(/\s+/g, "");
      const payoutYen = Number(payoutText.replace(/[^0-9]/g, ""));
      const popularityText = cells.eq(3).text().replace(/\s+/g, "");
      const popularity = Number(popularityText.replace(/[^0-9]/g, ""));
      const returned = cells.eq(3).text().includes("■") || $(row).html()?.includes("返還") === true;
      const raceId = `${date.replaceAll("-", "")}-${venue}-${String(raceNo).padStart(2, "0")}`;

      results.push({
        raceId,
        date,
        venue,
        raceNo,
        trifecta: boatNumbers.join("-"),
        payoutYen: Number.isFinite(payoutYen) && payoutYen > 0 ? payoutYen : null,
        popularity: Number.isFinite(popularity) && popularity > 0 ? popularity : null,
        returned,
        source: "kyotei24",
        fetchedAt,
      });
    });
  });

  return results;
}

function parseVenue($: CheerioAPI, table: Parameters<CheerioAPI>[0]): string | null {
  const headerText = $(table).find("tr").first().text().replace(/\s+/g, " ").trim();
  const match = headerText.match(/#\d{2}\s+([^\s\[]+)/);
  return match?.[1] ?? null;
}
