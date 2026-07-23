import * as cheerio from "cheerio";

/**
 * BOAT RACE公式の「2連単・2連複オッズ」ページから2連単だけを抽出する。
 *
 * 同じページに2連複テーブルもあるため、買い目の桁数だけでは判別せず、
 * 「2連単オッズ」見出しに対応するテーブルだけを読む。
 */
export function parseAllExactaOdds(html: string): Map<string, number> {
  const $ = cheerio.load(html);
  const result = new Map<string, number>();

  for (const heading of $(".title7_mainLabel").toArray()) {
    if (normalize($(heading).text()) !== "2連単オッズ") continue;

    const title = $(heading).closest(".title7");
    const table = title.nextAll(".table1").first().find("table").first();
    if (table.length === 0) continue;

    const firstBoats = table.find("thead tr").first().find("th, td").toArray()
      .map((cell, column) => ({
        first: Number($(cell).text().trim()),
        column,
        isBoatHeader: /(?:^|\s)is-boatColor[1-6](?:\s|$)/u.test($(cell).attr("class") ?? ""),
      }))
      .filter((cell) => cell.isBoatHeader && isBoatNumber(cell.first));

    for (const row of table.find("tbody tr").toArray()) {
      const cells = $(row).find("th, td").toArray();
      for (const { first, column } of firstBoats) {
        const secondCell = cells[column];
        const oddsCell = cells[column + 1];
        if (!secondCell || !oddsCell) continue;

        const second = Number($(secondCell).text().trim());
        if (!isBoatNumber(second) || first === second) continue;

        const odds = parseOdds($(oddsCell).text());
        if (odds != null) result.set(`${first}-${second}`, odds);
      }
    }
  }

  return result;
}

export function parseExactaOdds(html: string, selection: number[]): number | null {
  if (selection.length !== 2 || !selection.every(isBoatNumber) || selection[0] === selection[1]) return null;
  return parseAllExactaOdds(html).get(selection.join("-")) ?? null;
}

function normalize(text: string): string {
  return text.replace(/[\s　]+/gu, "");
}

function isBoatNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function parseOdds(text: string): number | null {
  const normalized = text.trim().replace(/,/gu, "");
  if (!normalized || /^(?:-|欠場|返還)$/u.test(normalized)) return null;
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
