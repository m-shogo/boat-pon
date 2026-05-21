import * as cheerio from "cheerio";

export function parseTrifectaOdds(html: string, selection: number[]): number | null {
  if (selection.length !== 3) return null;
  const key = selection.join("-");
  const $ = cheerio.load(html);

  const officialMatch = matchOfficialTable($, selection);
  if (officialMatch != null) return officialMatch;

  for (const td of $("td").toArray()) {
    const text = $(td).text().replace(/\s+/g, "");
    if (text !== key) continue;
    const sibling = $(td).next();
    const candidate = parseOddsText(sibling.text());
    if (candidate != null) return candidate;
  }

  const flatText = $.root().text().replace(/[\s　]+/g, " ");
  const regex = new RegExp(`${escapeRegex(key)}\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const match = flatText.match(regex);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function matchOfficialTable($: cheerio.CheerioAPI, selection: number[]): number | null {
  const [first, second, third] = selection;
  const tables = $("table").toArray();
  for (let i = 0; i < tables.length; i += 1) {
    const $table = $(tables[i]);
    const context = [
      $table.prev().text(),
      $table.find("caption").text(),
      $table.find("thead").text(),
    ].join(" ");
    const headingMatchesFirst =
      new RegExp(`${first}\\s*コース`).test(context) ||
      new RegExp(`1着[\\s　]*${first}`).test(context) ||
      new RegExp(`${first}[\\s　]*1着`).test(context);
    if (!headingMatchesFirst) continue;

    const headerCols = $table.find("thead tr").last().find("th, td")
      .map((_, el) => Number($(el).text().trim())).get();
    const secondColIndex = headerCols.indexOf(second);
    if (secondColIndex < 0) continue;

    for (const tr of $table.find("tbody tr").toArray()) {
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

function parseOddsText(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
