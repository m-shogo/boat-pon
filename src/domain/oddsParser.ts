import * as cheerio from "cheerio";

export function isTrifectaSelectionUnavailable(html: string, selection: number[]): boolean {
  if (selection.length !== 3) return false;
  const $ = cheerio.load(html);
  return checkGroupedTableCellUnavailable($, selection);
}

export function parseTrifectaOdds(html: string, selection: number[]): number | null {
  if (selection.length !== 3) return null;
  const key = selection.join("-");
  const $ = cheerio.load(html);

  const groupedOfficialMatch = matchOfficialGroupedTable($, selection);
  if (groupedOfficialMatch != null) return groupedOfficialMatch;

  const officialMatch = matchOfficialTable($, selection);
  if (officialMatch != null) return officialMatch;

  const splitRowMatch = matchSplitSelectionRows($, selection);
  if (splitRowMatch != null) return splitRowMatch;

  for (const td of $("td").toArray()) {
    const text = normalizeSelectionText($(td).text());
    if (text !== key) continue;
    const sibling = $(td).next();
    const candidate = parseOddsText(sibling.text());
    if (candidate != null) return candidate;
  }

  const flatText = $.root().text().replace(/[\s　]+/g, " ");
  const separator = "[\\s　]*(?:-|→|>|ー|－|−)[\\s　]*";
  const regex = new RegExp(`(?:^|[^0-9])${selection[0]}${separator}${selection[1]}${separator}${selection[2]}\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const match = flatText.match(regex);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

type GridCell = {
  text: string;
};

function matchOfficialGroupedTable($: cheerio.CheerioAPI, selection: number[]): number | null {
  const [first, second, third] = selection;
  for (const table of $("table").toArray()) {
    const $table = $(table);
    if ($table.find(".oddsPoint").length === 0) continue;

    const headerGrid = buildTableGrid($, $table.find("thead tr").toArray());
    const bodyGrid = buildTableGrid($, $table.find("tbody tr").toArray());
    if (headerGrid.length === 0 || bodyGrid.length === 0) continue;

    const firstPlaceColumns: Array<{ firstPlace: number; column: number }> = [];
    for (const row of headerGrid) {
      for (let column = 0; column < row.length; column += 1) {
        const value = Number(row[column]?.text.trim());
        if (Number.isInteger(value) && value >= 1 && value <= 6) {
          firstPlaceColumns.push({ firstPlace: value, column });
        }
      }
    }

    for (const group of firstPlaceColumns) {
      if (group.firstPlace !== first) continue;
      for (const row of bodyGrid) {
        const secondCell = row[group.column];
        const thirdCell = row[group.column + 1];
        const oddsCell = row[group.column + 2];
        if (!secondCell || !thirdCell || !oddsCell) continue;
        if (Number(secondCell.text.trim()) !== second) continue;
        if (Number(thirdCell.text.trim()) !== third) continue;
        const value = parseOddsText(oddsCell.text);
        if (value != null) return value;
      }
    }
  }
  return null;
}

function buildTableGrid($: cheerio.CheerioAPI, rows: Array<Parameters<cheerio.CheerioAPI>[0]>): GridCell[][] {
  const grid: GridCell[][] = [];
  const rowSpans = new Map<number, { cell: GridCell; remaining: number }>();

  rows.forEach((tr, rowIndex) => {
    const row: GridCell[] = [];
    for (const [column, span] of [...rowSpans.entries()].sort(([a], [b]) => a - b)) {
      row[column] = span.cell;
      span.remaining -= 1;
      if (span.remaining <= 0) {
        rowSpans.delete(column);
      }
    }

    let column = 0;
    for (const el of $(tr).find("th, td").toArray()) {
      while (row[column]) column += 1;
      const cell = { text: $(el).text().replace(/[\s　]+/g, " ").trim() };
      const colspan = Number($(el).attr("colspan") ?? 1);
      const rowspan = Number($(el).attr("rowspan") ?? 1);
      const width = Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
      const height = Number.isFinite(rowspan) && rowspan > 0 ? rowspan : 1;

      for (let offset = 0; offset < width; offset += 1) {
        row[column + offset] = cell;
        if (height > 1) {
          rowSpans.set(column + offset, { cell, remaining: height - 1 });
        }
      }
      column += width;
    }

    grid[rowIndex] = row;
  });

  return grid;
}

function matchOfficialTable($: cheerio.CheerioAPI, selection: number[]): number | null {
  const [first, second, third] = selection;
  const tables = $("table").toArray();
  for (let i = 0; i < tables.length; i += 1) {
    const $table = $(tables[i]);
    const context = collectTableContext($, $table);
    const headingMatchesFirst =
      new RegExp(`${first}\\s*コース`).test(context) ||
      new RegExp(`1着[\\s　]*${first}`).test(context) ||
      new RegExp(`${first}[\\s　]*1着`).test(context) ||
      new RegExp(`${first}[艇号]?[\\s　]*1着`).test(context);
    if (!headingMatchesFirst) continue;

    const headerCols = $table.find("thead tr").last().find("th, td")
      .map((_, el) => Number($(el).text().trim())).get()
      .filter((n) => Number.isFinite(n));
    const secondColIndex = headerCols.indexOf(second);
    if (secondColIndex < 0) continue;

    const rows = $table.find("tbody tr").length ? $table.find("tbody tr").toArray() : $table.find("tr").toArray();
    for (const tr of rows) {
      if ($(tr).closest("thead").length > 0) continue;
      const rowHeader = Number($(tr).find("th, td").first().text().trim());
      if (rowHeader !== third) continue;
      const cells = $(tr).find("th, td").slice(1);
      const cell = cells.eq(secondColIndex);
      if (cell.length === 0) continue;
      const value = parseOddsText(cell.text());
      if (value != null) return value;
    }
  }
  return null;
}

function matchSplitSelectionRows($: cheerio.CheerioAPI, selection: number[]): number | null {
  const key = selection.join("-");
  for (const tr of $("tr").toArray()) {
    if ($(tr).closest("thead").length > 0) continue;
    const cells = $(tr).find("th, td").toArray().map((cell) => $(cell).text().replace(/[\s　]+/g, " ").trim());
    if (cells.length < 4) continue;
    const normalized = normalizeSelectionText(cells.slice(0, 3).join("-"));
    if (normalized !== key) continue;
    for (const cell of cells.slice(3)) {
      const odds = parseOddsText(cell);
      if (odds != null) return odds;
    }
  }
  return null;
}

function collectTableContext($: cheerio.CheerioAPI, $table: ReturnType<cheerio.CheerioAPI>) {
  const prevTexts: string[] = [];
  let prev = $table.prev();
  for (let i = 0; i < 3 && prev.length; i += 1) {
    prevTexts.push(prev.text());
    prev = prev.prev();
  }
  return [
    ...prevTexts,
    $table.closest("section, div, article").find("h1, h2, h3, h4, caption").first().text(),
    $table.find("caption").text(),
    $table.find("thead").text(),
  ].join(" ");
}

function isUnavailableOddsText(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:-|欠場|返還)$/u.test(trimmed);
}

function checkGroupedTableCellUnavailable($: cheerio.CheerioAPI, selection: number[]): boolean {
  const [first, second, third] = selection;
  for (const table of $("table").toArray()) {
    const $table = $(table);
    if ($table.find(".oddsPoint").length === 0) continue;

    const headerGrid = buildTableGrid($, $table.find("thead tr").toArray());
    const bodyGrid = buildTableGrid($, $table.find("tbody tr").toArray());
    if (headerGrid.length === 0 || bodyGrid.length === 0) continue;

    const firstPlaceColumns: Array<{ firstPlace: number; column: number }> = [];
    for (const row of headerGrid) {
      for (let column = 0; column < row.length; column += 1) {
        const value = Number(row[column]?.text.trim());
        if (Number.isInteger(value) && value >= 1 && value <= 6) {
          firstPlaceColumns.push({ firstPlace: value, column });
        }
      }
    }

    for (const group of firstPlaceColumns) {
      if (group.firstPlace !== first) continue;
      for (const row of bodyGrid) {
        const secondCell = row[group.column];
        const thirdCell = row[group.column + 1];
        const oddsCell = row[group.column + 2];
        if (!secondCell || !thirdCell || !oddsCell) continue;
        if (Number(secondCell.text.trim()) !== second) continue;
        if (Number(thirdCell.text.trim()) !== third) continue;
        if (isUnavailableOddsText(oddsCell.text)) return true;
      }
    }
  }
  return false;
}

function parseOddsText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || /^(?:-|欠場|返還)$/u.test(trimmed)) return null;
  const match = trimmed.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeSelectionText(text: string) {
  return text
    .replace(/[\s　]+/g, "")
    .replace(/[→>ー－−]/g, "-")
    .match(/[1-6]-?[1-6]-?[1-6]/)?.[0]
    .replace(/(\d)(?=\d)/g, "$1-") ?? "";
}
