/**
 * あなたの予想の台帳（2026-11-19〜）。締切前に記録した 3連単の買い目を、市場と同じ物差しで採点する。
 * 用途: 精度（人の感覚が、締切5分前の市場の確率よりどれだけ当たるか）。購入の指示ではない。
 */
export type MyPick = { raceId: string; selection: string; recordedAt: string; closeAt: string; note?: string };

/** "1-2-3" の形で、1〜6 の違う 3 艇か */
export function isTrifectaSelection(selection: string): boolean {
  if (!/^[1-6]-[1-6]-[1-6]$/.test(selection)) return false;
  return new Set(selection.split("-")).size === 3;
}

/** "1-2-3,1-3-2" や "1-2-3 1-3-2" を買い目の配列にする。形が違うものがあれば例外 */
export function parseSelections(text: string): string[] {
  const items = text.split(/[,\s、]+/).map((s) => s.trim().replace(/[ー－–]/g, "-")).filter(Boolean);
  const bad = items.filter((s) => !isTrifectaSelection(s));
  if (items.length === 0 || bad.length > 0) throw new Error(`3連単の買い目は 1-2-3 の形で（違う 3 艇）: ${bad.join(" ") || "(空)"}`);
  return [...new Set(items)];
}

/** 締切より前に記録したか（締切の時刻ちょうど以降は数えない） */
export function recordedBeforeClose(recordedAt: string, date: string, closeAt: string): boolean {
  const close = Date.parse(`${date}T${closeAt}:00+09:00`);
  return Number.isFinite(close) && Date.parse(recordedAt) < close;
}

export type ScoredPick = { status: "hit" | "miss" | "returned" | "pending"; marketProbability: number | null; payoutYen: number | null };

/** 採点: 実際の的中数と、締切5分前の市場の確率から出した見込みの的中数（返還・結果待ちは数えない）、100 円ずつの回収率 */
export function summarizeMyPicks(rows: ScoredPick[]) {
  const settled = rows.filter((r) => r.status === "hit" || r.status === "miss");
  const withMarket = settled.filter((r) => r.marketProbability != null);
  const hits = settled.filter((r) => r.status === "hit").length;
  const expected = withMarket.reduce((sum, r) => sum + r.marketProbability!, 0);
  const hitsWithMarket = withMarket.filter((r) => r.status === "hit").length;
  const variance = withMarket.reduce((sum, r) => sum + r.marketProbability! * (1 - r.marketProbability!), 0);
  const payout = settled.reduce((sum, r) => sum + (r.status === "hit" ? r.payoutYen ?? 0 : 0), 0);
  return {
    picks: rows.length,
    settled: settled.length,
    hits,
    returned: rows.filter((r) => r.status === "returned").length,
    pending: rows.filter((r) => r.status === "pending").length,
    marketExpectedHits: withMarket.length ? expected : null,
    actualToMarket: expected > 0 ? hitsWithMarket / expected : null,
    z: variance > 0 ? (hitsWithMarket - expected) / Math.sqrt(variance) : null,
    officialRoi: settled.length ? payout / (settled.length * 100) : null,
  };
}
