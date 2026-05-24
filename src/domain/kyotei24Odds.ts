import * as cheerio from "cheerio";

export type Kyotei24OddsTarget = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
};

export type ParsedKyotei24Odds = {
  raceId: string;
  selection: string;
  odds: number;
  popularity: number | null;
  source: "kyotei24";
  capturedAt: string;
  isFinalLike: boolean;
};

const venueMeta: Record<string, { jcd: string; slug: string }> = {
  桐生: { jcd: "01", slug: "kiryu" },
  戸田: { jcd: "02", slug: "toda" },
  江戸川: { jcd: "03", slug: "edogawa" },
  平和島: { jcd: "04", slug: "heiwajima" },
  多摩川: { jcd: "05", slug: "tamagawa" },
  浜名湖: { jcd: "06", slug: "hamanako" },
  蒲郡: { jcd: "07", slug: "gamagori" },
  常滑: { jcd: "08", slug: "tokoname" },
  津: { jcd: "09", slug: "tsu" },
  三国: { jcd: "10", slug: "mikuni" },
  びわこ: { jcd: "11", slug: "biwako" },
  住之江: { jcd: "12", slug: "suminoe" },
  尼崎: { jcd: "13", slug: "amagasaki" },
  鳴門: { jcd: "14", slug: "naruto" },
  丸亀: { jcd: "15", slug: "marugame" },
  児島: { jcd: "16", slug: "kojima" },
  宮島: { jcd: "17", slug: "miyajima" },
  徳山: { jcd: "18", slug: "tokuyama" },
  下関: { jcd: "19", slug: "shimonoseki" },
  若松: { jcd: "20", slug: "wakamatsu" },
  芦屋: { jcd: "21", slug: "ashiya" },
  福岡: { jcd: "22", slug: "fukuoka" },
  唐津: { jcd: "23", slug: "karatsu" },
  大村: { jcd: "24", slug: "omura" },
};

export function kyotei24OddsUrls(target: Pick<Kyotei24OddsTarget, "date" | "venue" | "raceNo">): string[] {
  const meta = venueMeta[target.venue];
  if (!meta) return [];
  const ymd = target.date.replaceAll("-", "");
  return [
    `https://odds.kyotei24.jp/odds3t-${meta.slug}-${ymd}-${target.raceNo}.html`,
    `https://odds.kyotei24.jp/od3t-${meta.slug}-${ymd}-${target.raceNo}.html`,
    `https://odds.kyotei24.jp/od-${ymd}-${meta.jcd}-${target.raceNo}.html`,
  ];
}

export function parseKyotei24TrifectaOdds(
  html: string,
  target: Kyotei24OddsTarget,
  capturedAt = new Date().toISOString(),
): ParsedKyotei24Odds | null {
  const normalizedSelection = normalizeSelection(target.selection);
  if (!normalizedSelection) return null;
  const $ = cheerio.load(html);

  for (const tr of $("tr").toArray()) {
    const rendered = parseRenderedBoatRow($, tr, normalizedSelection);
    if (rendered) return toParsed(target, rendered.odds, rendered.popularity, capturedAt);

    const cells = $(tr).find("th, td").toArray().map((cell) => visibleCellText($, cell));
    const row = parseCells(cells, normalizedSelection);
    if (row) return toParsed(target, row.odds, row.popularity, capturedAt);
  }

  const text = $.root().text().replace(/[\s　]+/g, " ");
  const escaped = normalizedSelection.replaceAll("-", "\\s*(?:-|→|>|ー|－|−)?\\s*");
  const regex = new RegExp(`(?:^|[^0-9])(?:([0-9]{1,3})\\s*番)?\\s*${escaped}\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const match = text.match(regex);
  if (!match) return null;
  return toParsed(target, Number(match[2]), match[1] == null ? null : Number(match[1]), capturedAt);
}

function parseRenderedBoatRow(
  $: cheerio.CheerioAPI,
  tr: Parameters<cheerio.CheerioAPI>[0],
  selection: string,
): { odds: number; popularity: number | null } | null {
  const nums = $(tr).find(".rb, .r0s, .r1, .r2, .r3, .r4, .r5, .r6").toArray()
    .map((el) => $(el).text().trim())
    .filter((value) => /^[1-6]$/.test(value))
    .slice(0, 3)
    .join("-");
  if (nums !== selection) return null;
  const oddsCell = $(tr).find(".odText, .od_text, td").last().get(0);
  const odds = oddsCell ? parseOdds(visibleCellText($, oddsCell)) : null;
  if (odds == null) return null;
  const popularity = findPopularity([$(tr).text()]);
  return { odds, popularity };
}

function visibleCellText($: cheerio.CheerioAPI, cell: Parameters<cheerio.CheerioAPI>[0]) {
  const cloned = $(cell).clone();
  cloned.find("[style*='display: none'], [style*='display:none'], script, style").remove();
  return cloned.text().replace(/[\s　]+/g, " ").trim();
}

function parseCells(cells: string[], selection: string): { odds: number; popularity: number | null } | null {
  if (cells.length < 2) return null;
  const normalized = cells.map((cell) => normalizeSelection(cell));
  const selectionIndex = normalized.findIndex((value) => value === selection);
  if (selectionIndex < 0) return null;
  const popularity = findPopularity(cells.slice(0, selectionIndex + 1));
  for (const cell of cells.slice(selectionIndex + 1)) {
    const odds = parseOdds(cell);
    if (odds != null) return { odds, popularity };
  }
  return null;
}

const MAX_VALID_ODDS = 1000;

function toParsed(target: Kyotei24OddsTarget, odds: number, popularity: number | null, capturedAt: string): ParsedKyotei24Odds | null {
  if (!Number.isFinite(odds) || odds <= 0 || odds > MAX_VALID_ODDS) return null;
  return {
    raceId: target.raceId,
    selection: normalizeSelection(target.selection),
    odds,
    popularity: Number.isFinite(popularity) ? popularity : null,
    source: "kyotei24",
    capturedAt,
    isFinalLike: true,
  };
}

function findPopularity(cells: string[]) {
  for (const cell of cells) {
    const match = cell.match(/(?:^|[^0-9])([0-9]{1,3})(?:番|位|人気|$)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function parseOdds(text: string) {
  const match = text.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeSelection(text: string) {
  const nums = text.match(/[1-6]/g)?.slice(0, 3) ?? [];
  return nums.length === 3 ? nums.join("-") : "";
}
