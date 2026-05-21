import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { RaceResult } from "./types";

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
