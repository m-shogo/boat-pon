export type OfficialProgramBoat = {
  course: number;
  registrationNo: string;
  racerName: string;
  className: string;
  nationalWinRate: number | null;
  nationalTop2Rate: number | null;
  localWinRate: number | null;
  localTop2Rate: number | null;
  motorNo: string | null;
  motorTop2Rate: number | null;
  boatNo: string | null;
  boatTop2Rate: number | null;
};

export type OfficialProgramRow = {
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  boats: OfficialProgramBoat[];
};

// 公式の旧表記→新表記マップ。「琵琶湖」(〜2020年頃) は「びわこ」に正規化する。
const VENUE_ALIASES: Record<string, string> = {
  琵琶湖: "びわこ",
};

const KNOWN_VENUES = [
  "桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国",
  "びわこ", "琵琶湖", "住之江", "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松",
  "芦屋", "福岡", "唐津", "大村",
].sort((a, b) => b.length - a.length);

function normalizeVenue(venue: string): string {
  return VENUE_ALIASES[venue] ?? venue;
}

export function parseOfficialProgramsText(
  text: string,
  defaults: { date: string },
): OfficialProgramRow[] {
  const lines = text.split(/\r?\n/);
  const rows: OfficialProgramRow[] = [];
  let venue: string | null = null;
  let pendingRaceNo: number | null = null;
  let closeAt: string | null = null;
  let boats: OfficialProgramBoat[] = [];

  function flushRace() {
    if (!venue || pendingRaceNo == null || !closeAt) return;
    rows.push({
      date: defaults.date,
      venue,
      raceNo: pendingRaceNo,
      closeAt,
      boats,
    });
    pendingRaceNo = null;
    closeAt = null;
    boats = [];
  }

  for (const raw of lines) {
    const line = toHalfWidth(raw).replace(/\t/g, " ");

    const detected = extractVenue(raw);
    if (detected) venue = detected;

    const raceHeaderMatch = line.match(/^[\s 　]*(\d{1,2})R\s/);
    if (raceHeaderMatch) {
      flushRace();
      pendingRaceNo = Number(raceHeaderMatch[1]);
      closeAt = null;
      boats = [];
    }

    const boat = parseBoatLine(line);
    if (boat && pendingRaceNo != null) {
      boats.push(boat);
    }

    const closeMatch = line.match(/電話投票締切予定[\s 　]*(\d{1,2})[:：]\s*(\d{1,2})/);
    if (closeMatch) {
      const hh = String(Number(closeMatch[1])).padStart(2, "0");
      const mm = String(Number(closeMatch[2])).padStart(2, "0");
      closeAt = `${hh}:${mm}`;
    }
  }
  flushRace();

  return rows;
}

function parseBoatLine(line: string): OfficialProgramBoat | null {
  const normalized = line.replace(/　/g, " ");
  const match = normalized.match(/^\s*([1-6])\s+(\d{4})(.+?)(\d{2})([^\d\s]{2,3})(\d{2})(A1|A2|B1|B2)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+)\s+(\d+\.\d{2})\s*(\d+)\s+(\d+\.\d{2})/);
  if (!match) return null;
  return {
    course: Number(match[1]),
    registrationNo: match[2],
    racerName: match[3].trim().replace(/\s+/g, " "),
    className: match[7],
    nationalWinRate: toNumber(match[8]),
    nationalTop2Rate: toNumber(match[9]),
    localWinRate: toNumber(match[10]),
    localTop2Rate: toNumber(match[11]),
    motorNo: match[12],
    motorTop2Rate: toNumber(match[13]),
    boatNo: match[14],
    boatTop2Rate: toNumber(match[15]),
  };
}

function extractVenue(line: string): string | null {
  if (!line.includes("ボートレース") && !line.includes("競艇場")) return null;
  const clean = line.replace(/[\s　]/g, "");
  for (const v of KNOWN_VENUES) {
    if (clean.includes("ボートレース" + v) || clean.includes(v + "競艇場")) {
      return normalizeVenue(v);
    }
  }
  return null;
}

function toNumber(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/Ｒ/g, "R")
    .replace(/：/g, ":");
}
