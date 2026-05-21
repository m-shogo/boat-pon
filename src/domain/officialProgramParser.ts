export type OfficialProgramRow = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
};

const KNOWN_VENUES = [
  "桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国",
  "びわこ", "住之江", "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松",
  "芦屋", "福岡", "唐津", "大村",
].sort((a, b) => b.length - a.length);

export function parseOfficialProgramsText(
  text: string,
  defaults: { date: string },
): OfficialProgramRow[] {
  const lines = text.split(/\r?\n/);
  const rows: OfficialProgramRow[] = [];
  let venue: string | null = null;
  let pendingRaceNo: number | null = null;

  for (const raw of lines) {
    const line = toHalfWidth(raw).replace(/\t/g, " ");

    const detected = extractVenue(raw);
    if (detected) venue = detected;

    const raceHeaderMatch = line.match(/^[\s 　]*(\d{1,2})R\s/);
    if (raceHeaderMatch) {
      pendingRaceNo = Number(raceHeaderMatch[1]);
    }

    const closeMatch = line.match(/電話投票締切予定[\s 　]*(\d{1,2})[:：]\s*(\d{1,2})/);
    if (closeMatch && venue && pendingRaceNo != null) {
      const hh = String(Number(closeMatch[1])).padStart(2, "0");
      const mm = String(Number(closeMatch[2])).padStart(2, "0");
      rows.push({
        date: defaults.date,
        venue,
        raceNo: pendingRaceNo,
        closeAt: `${hh}:${mm}`,
      });
      pendingRaceNo = null;
    }
  }

  return rows;
}

function extractVenue(line: string): string | null {
  if (!line.includes("ボートレース") && !line.includes("競艇場")) return null;
  const clean = line.replace(/[\s　]/g, "");
  for (const v of KNOWN_VENUES) {
    if (clean.includes("ボートレース" + v) || clean.includes(v + "競艇場")) {
      return v;
    }
  }
  return null;
}

function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/Ｒ/g, "R")
    .replace(/：/g, ":");
}
