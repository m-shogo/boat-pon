import { load } from "cheerio";

export type HistoricalRacerMetadata = {
  registrationNo: string;
  age: number | null;
  branch: string | null;
  gender: string | null;
  bloodType: string | null;
  heightCm: number | null;
  weightKg: number | null;
};

/** 保存済みレース前HTMLから、その時点で表示されていた6艇の人物metadataを読む。 */
export function parseKyotei24RacerMetadata(html: string): HistoricalRacerMetadata[] {
  const $ = load(html);
  const branchCells = rowValues($, "支部");
  const infoCells = rowValues($, "選手情報");
  return $("td.name-td").slice(0, 6).toArray().flatMap((cell, index) => {
    const href = $(cell).find("a[href*='racer-']").first().attr("href") ?? "";
    const registrationNo = href.match(/racer-(\d{4})\.html/)?.[1];
    if (!registrationNo) return [];
    const age = numberMatch($(cell).find(".age").text(), /\((\d+)\)/);
    const branch = branchCells[index]?.trim() || null;
    const info = infoCells[index] ?? "";
    const person = info.match(/^\s*(男|女)\s*(AB|A|B|O)/);
    return [{ registrationNo, age, branch, gender: person?.[1] ?? null, bloodType: person?.[2] ?? null,
      heightCm: numberMatch(info, /(\d{3})\s*cm/i), weightKg: numberMatch(info, /(\d{2,3})\s*kg/i) }];
  });
}

function rowValues($: ReturnType<typeof load>, label: string) {
  const row = $("tr").filter((_index, element) => $(element).find("td.labelTitle").first().text().replace(/\s+/g, "") === label).first();
  return row.find("td").slice(1).toArray().map(cell => $(cell).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim());
}
function numberMatch(value: string, pattern: RegExp) { const match = value.match(pattern); return match ? Number(match[1]) : null; }
