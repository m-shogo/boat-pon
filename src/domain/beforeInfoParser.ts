import * as cheerio from "cheerio";
import type { RaceEnvironment } from "./raceEnvironment";

export type ExhibitionEntryLike = {
  course: number;
  exhibitionTime: number | null;
  startTiming: number | null;
  ranking: number | null;
};

export type RaceEquipmentEntry = {
  course: number;
  tiltAngle: number | null;
  propellerChanged: boolean;
  partsChanged: string[];
  partsChangedCount: number;
};

export type BeforeInfoSnapshot = {
  exhibition: ExhibitionEntryLike[];
  weather: RaceEnvironment | null;
  equipment: RaceEquipmentEntry[];
};

const PART_LABELS: Record<string, string> = {
  ピストン: "ピストン",
  リング: "ピストンリング",
  電気: "電気一式",
  キャブ: "キャブレター",
  シリンダ: "シリンダ",
  シャフト: "クランクシャフト",
  ギヤ: "ギヤケース",
  キャリボ: "キャリアボデー",
};

export function parseBeforeInfoHtml(html: string): BeforeInfoSnapshot {
  return {
    exhibition: parseExhibitionHtml(html),
    weather: parseWeatherHtml(html),
    equipment: parseEquipmentHtml(html),
  };
}

export function parseExhibitionHtml(html: string): ExhibitionEntryLike[] {
  const $ = cheerio.load(html);
  const exhibitionTimeMap = new Map<number, number>();

  $("table").each((_i, table) => {
    const headerText = headerTextOf($, table);
    if (!headerText.includes("展示") || !headerText.includes("タイム")) return;

    $(table).find("tbody").each((_bi, tbody) => {
      const cells = $(tbody).find("tr").first().find("th, td").map((_, el) => cleanText($(el).text())).get();
      const course = toCourse(cells[0]);
      if (course == null) return;
      const exTime = firstDecimalInRange(cells.slice(1), 5, 10);
      if (exTime != null) exhibitionTimeMap.set(course, exTime);
    });
  });

  const startTimingMap = parseStartTimingMap($);
  const entries: ExhibitionEntryLike[] = [];
  for (let course = 1; course <= 6; course += 1) {
    const exhibitionTime = exhibitionTimeMap.get(course) ?? null;
    const startTiming = startTimingMap.get(course) ?? null;
    if (exhibitionTime != null || startTiming != null) {
      entries.push({ course, exhibitionTime, startTiming, ranking: null });
    }
  }

  if (entries.length > 0) return entries;
  return parseExhibitionFallback($);
}

export function parseEquipmentHtml(html: string): RaceEquipmentEntry[] {
  const $ = cheerio.load(html);
  const entries: RaceEquipmentEntry[] = [];

  $("table").each((_i, table) => {
    const headerText = headerTextOf($, table);
    if (!headerText.includes("チルト") && !headerText.includes("部品交換") && !headerText.includes("プロペラ")) return;

    $(table).find("tbody").each((_bi, tbody) => {
      const firstRowCells = $(tbody).find("tr").first().find("th, td").toArray();
      const texts = firstRowCells.map((el) => cleanText($(el).text()));
      const course = toCourse(texts[0]);
      if (course == null) return;

      const tiltAngle = parseSignedNumber(texts[5]);
      const propellerText = texts[6] ?? "";
      const partsText = texts[7] ?? "";
      const partsChanged = normalizeParts(partsText);
      const propellerChanged = /新|交換|変更/.test(propellerText);

      entries.push({
        course,
        tiltAngle,
        propellerChanged,
        partsChanged,
        partsChangedCount: partsChanged.length,
      });
    });
  });

  return entries;
}

export function parseWeatherHtml(html: string): RaceEnvironment | null {
  const $ = cheerio.load(html);
  const block = $(".weather1");
  if (block.length === 0) return null;

  let weather: string | null = null;
  let windSpeedMps: number | null = null;
  let waveHeightCm: number | null = null;
  let temperatureC: number | null = null;
  let waterTemperatureC: number | null = null;
  let stablePlate = false;
  let shortenedLaps = false;

  const weatherUnit = block.find(".is-weather");
  if (weatherUnit.length > 0) {
    const title = cleanText(weatherUnit.find(".weather1_bodyUnitLabelTitle").text());
    if (title) weather = title;
  }

  const windUnit = block.find(".is-wind");
  if (windUnit.length > 0) {
    windSpeedMps = parseUnsignedNumber(windUnit.find(".weather1_bodyUnitLabelData").text());
  }

  const waveUnit = block.find(".is-wave");
  if (waveUnit.length > 0) {
    waveHeightCm = parseUnsignedNumber(waveUnit.find(".weather1_bodyUnitLabelData").text());
  }

  block.find(".weather1_bodyUnit").each((_, el) => {
    const label = cleanText($(el).find(".weather1_bodyUnitLabelTitle").text());
    const data = $(el).find(".weather1_bodyUnitLabelData").text();
    const num = parseUnsignedNumber(data);
    if (label === "気温" && num != null) temperatureC = num;
    if (label === "水温" && num != null) waterTemperatureC = num;
  });

  const bodyText = $("body").text();
  if (/安定板/.test(bodyText)) stablePlate = true;
  if (/周回短縮/.test(bodyText)) shortenedLaps = true;

  if (weather == null && windSpeedMps == null && waveHeightCm == null) return null;
  return { weather, windSpeedMps, waveHeightCm, temperatureC, waterTemperatureC, stablePlate, shortenedLaps };
}

function parseStartTimingMap($: cheerio.CheerioAPI): Map<number, number> {
  const startTimingMap = new Map<number, number>();
  $("table").each((_i, table) => {
    const headerText = headerTextOf($, table);
    if (!headerText.includes("スタート展示") && !headerText.includes("ST")) return;
    $(table).find("tbody tr").each((_j, tr) => {
      const cellText = cleanText($(tr).find("th, td").first().text());
      const m = cellText.match(/^([1-6])\s+([.\-\d]+)$/);
      if (!m) return;
      const stRaw = m[2].startsWith(".") ? `0${m[2]}` : m[2];
      const st = Number(stRaw);
      if (Number.isFinite(st) && st > -1 && st < 1) startTimingMap.set(Number(m[1]), st);
    });
  });
  return startTimingMap;
}

function parseExhibitionFallback($: cheerio.CheerioAPI): ExhibitionEntryLike[] {
  const entries: ExhibitionEntryLike[] = [];
  const lines = $.root().text().split(/\n/).map((line) => cleanText(line)).filter(Boolean);
  for (const line of lines) {
    const courseMatch = line.match(/^([1-6])\s/);
    if (!courseMatch) continue;
    const course = Number(courseMatch[1]);
    const timeMatch = line.match(/([5-9]\.\d{2})/);
    const stMatch = line.match(/([-]?\d\.\d{2})/);
    entries.push({
      course,
      exhibitionTime: timeMatch ? Number(timeMatch[1]) : null,
      startTiming: stMatch ? Number(stMatch[1]) : null,
      ranking: null,
    });
  }
  return entries;
}

function normalizeParts(text: string): string[] {
  const normalized = cleanText(text);
  if (!normalized || normalized === "&nbsp;") return [];
  const parts: string[] = [];
  for (const [label, fullName] of Object.entries(PART_LABELS)) {
    if (normalized.includes(label)) parts.push(fullName);
  }
  if (parts.length > 0) return [...new Set(parts)];
  return normalized.split(/[、,\s/]+/).map((part) => part.trim()).filter(Boolean);
}

function headerTextOf($: cheerio.CheerioAPI, table: Parameters<cheerio.CheerioAPI>[0]) {
  return $(table).find("th").map((_, el) => cleanText($(el).text()).replace(/\s+/g, "")).get().join("|");
}

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function toCourse(value: string | undefined) {
  const course = Number(cleanText(value ?? ""));
  return Number.isInteger(course) && course >= 1 && course <= 6 ? course : null;
}

function firstDecimalInRange(values: string[], min: number, max: number) {
  for (const value of values) {
    if (!/\d+\.\d+/.test(value)) continue;
    const num = parseUnsignedNumber(value);
    if (num != null && num >= min && num <= max) return num;
  }
  return null;
}

function parseUnsignedNumber(value: string) {
  const m = value.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseSignedNumber(value: string | undefined) {
  const m = String(value ?? "").match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}
