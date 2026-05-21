import * as cheerio from "cheerio";

export function parseKyotei24Odds(html: string, selection: number[]): number | null {
  if (selection.length !== 3) return null;
  const key = selection.join("-");
  const $ = cheerio.load(html);

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
