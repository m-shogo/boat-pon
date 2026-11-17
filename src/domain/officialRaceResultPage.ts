/**
 * 公式サイトのレース結果ページ（boatrace.jp/owpc/pc/race/raceresult）から、3連単の確定組番と払戻を取り出す。
 * BUY を出したレースの「速報」通知用。正式な精算は翌日の K ファイル取り込み（race_results）で行う。
 * 結果がまだ出ていない・形が想定と違うときは null を返す（通知しない）。
 */
/** refundBoats は「返還」の欄の艇（フライング・出遅れ・欠場）。その艇を含む買い目は返還になる。 */
export type RaceResultTrifecta = { combinations: string[]; payoutYen: number | null; refundBoats: number[] };

export function parseRaceResultTrifecta(html: string): RaceResultTrifecta | null {
  const label = html.search(/<td[^>]*>\s*3連単\s*<\/td>/);
  if (label < 0) return null;
  const tbodyStart = html.lastIndexOf("<tbody", label);
  const tbodyEnd = html.indexOf("</tbody>", label);
  if (tbodyStart < 0 || tbodyEnd < 0) return null;
  const tbody = html.slice(tbodyStart, tbodyEnd);
  const combinations: string[] = [];
  let payoutYen: number | null = null;
  for (const row of tbody.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const numbers = [...row.matchAll(/numberSet1_number[^>]*>\s*([1-6])\s*</g)].map((m) => m[1]);
    if (numbers.length !== 3) continue;
    combinations.push(numbers.join("-"));
    const payout = row.match(/is-payout1[^>]*>\s*(?:&yen;|¥|￥)\s*([\d,]+)/);
    if (payout && payoutYen == null) payoutYen = Number(payout[1].replaceAll(",", ""));
  }
  return combinations.length ? { combinations, payoutYen, refundBoats: parseRefundBoats(html) } : null;
}

/** 「返還」の欄（<th>返還</th> の表）に並ぶ艇番。欄が無い・空なら []。 */
export function parseRefundBoats(html: string): number[] {
  const head = html.search(/<th[^>]*>\s*返還\s*<\/th>/);
  if (head < 0) return [];
  const end = html.indexOf("</tbody>", head);
  if (end < 0) return [];
  return [...html.slice(head, end).matchAll(/numberSet1_number[^>]*>\s*([1-6])\s*</g)].map((m) => Number(m[1]));
}
