import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { DatabaseSync } from "node:sqlite";
import type { RaceResult } from "../src/domain/types";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const rawPath = path.join("data", "raw", "kyotei24", "results", `${date}.html`);
const normalizedDir = path.join("data", "normalized", "results");
const normalizedPath = path.join(normalizedDir, `${date}.json`);

if (!existsSync(rawPath)) {
  throw new Error(`raw file not found: ${rawPath}. Run npm run fetch:kyotei24 first.`);
}

const html = await readFile(rawPath, "utf8");
const $ = cheerio.load(html);
const fetchedAt = new Date().toISOString();
const results: RaceResult[] = [];

$("tr").each((_, row) => {
  const text = $(row).text().replace(/\s+/g, " ").trim();
  const raceMatch = text.match(/(桐生|戸田|江戸川|平和島|多摩川|浜名湖|蒲郡|常滑|津|三国|びわこ|住之江|尼崎|鳴門|丸亀|児島|宮島|徳山|下関|若松|芦屋|福岡|唐津|大村).*?(\d{1,2})R/);
  const trifectaMatch = text.match(/([1-6])[-－]([1-6])[-－]([1-6])/);
  const payoutMatch = text.match(/([0-9,]+)円/);
  const popularityMatch = text.match(/(\d+)番人気/);

  if (!raceMatch || !trifectaMatch) return;

  const venue = raceMatch[1];
  const raceNo = Number(raceMatch[2]);
  const trifecta = `${trifectaMatch[1]}-${trifectaMatch[2]}-${trifectaMatch[3]}`;
  const raceId = `${date.replaceAll("-", "")}-${venue}-${String(raceNo).padStart(2, "0")}`;

  results.push({
    raceId,
    date,
    venue,
    raceNo,
    trifecta,
    payoutYen: payoutMatch ? Number(payoutMatch[1].replaceAll(",", "")) : null,
    popularity: popularityMatch ? Number(popularityMatch[1]) : null,
    returned: /返還/.test(text),
    source: "kyotei24",
    fetchedAt,
  });
});

await mkdir(normalizedDir, { recursive: true });
await writeFile(normalizedPath, JSON.stringify({ source: "kyotei24", date, fetchedAt, results }, null, 2), "utf8");

await import("./init-db");
const db = new DatabaseSync("data/boat.sqlite");
const insert = db.prepare(`
INSERT OR REPLACE INTO race_results
(race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const result of results) {
  insert.run(
    result.raceId,
    result.date,
    result.venue,
    result.raceNo,
    result.trifecta,
    result.payoutYen,
    result.popularity,
    result.returned ? 1 : 0,
    result.source,
    result.fetchedAt,
  );
}

db.close();
console.log(`normalized ${results.length} results: ${normalizedPath}`);
