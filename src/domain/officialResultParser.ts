import type { RaceResult } from "./types";

// 公式の旧表記→新表記マップ。「琵琶湖」(〜2020年頃) は「びわこ」に正規化する。
const VENUE_ALIASES: Record<string, string> = {
  琵琶湖: "びわこ",
};

function normalizeVenue(venue: string): string {
  return VENUE_ALIASES[venue] ?? venue;
}

export function parseOfficialResultsText(
  text: string,
  defaults: { date: string; fetchedAt: string },
): RaceResult[] {
  const results: RaceResult[] = [];
  const lines = text.split(/\r?\n/);

  let venue: string | null = null;
  let date = defaults.date;
  let lastRaceNo: number | null = null;
  let pendingReturned = false;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, " ");

    const venueMatch = line.match(/^(.+?)［成績］/);
    if (venueMatch) {
      const raw = venueMatch[1].replace(/[\s　]/g, "");
      venue = normalizeVenue(raw);
      continue;
    }

    const dateMatch = line.match(/(\d{4})\/\s*(\d{1,2})\/\s*(\d{1,2})/);
    if (dateMatch && line.includes("ボートレース")) {
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
      continue;
    }

    const raceMatch = line.match(/^\s*(\d{1,2})R\s+\S/);
    if (raceMatch && venue) {
      lastRaceNo = Number(raceMatch[1]);
      pendingReturned = false;
      continue;
    }

    if (lastRaceNo != null && (line.includes("不成立") || line.includes("特払い"))) {
      pendingReturned = true;
    }

    const trifectaMatch = line.match(/３連単[\s　]+(\d)-(\d)-(\d)[\s　]+([0-9,]+)[\s　]+人気[\s　]+(\d+)/);
    if (trifectaMatch && venue && lastRaceNo != null) {
      const trifecta = `${trifectaMatch[1]}-${trifectaMatch[2]}-${trifectaMatch[3]}`;
      const payoutYen = Number(trifectaMatch[4].replaceAll(",", ""));
      const popularity = Number(trifectaMatch[5]);
      results.push({
        raceId: `${date.replaceAll("-", "")}-${venue}-${String(lastRaceNo).padStart(2, "0")}`,
        date,
        venue,
        raceNo: lastRaceNo,
        trifecta,
        payoutYen: Number.isFinite(payoutYen) && payoutYen > 0 ? payoutYen : null,
        popularity: Number.isFinite(popularity) && popularity > 0 ? popularity : null,
        returned: pendingReturned,
        source: "official",
        fetchedAt: defaults.fetchedAt,
      });
      lastRaceNo = null;
      pendingReturned = false;
    }
  }

  return results;
}
