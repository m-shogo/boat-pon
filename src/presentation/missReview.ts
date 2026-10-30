/** Read-only analysis of saved BUY probabilities and official settlement. */
export type MissReviewRow = {
  raceId: string; venue: string; raceNo: number; betType: string; selection: string;
  result: string | null; returned: number; officialReturned: number | null;
  estimatedHitRate: number | null; currentOdds: number | null; ev: number | null;
  recommendedStakeYen: number; actuallyBought: number; stakeYen: number;
  modelVersion: string | null; runKind: string;
  payoutMatches: number; officialPayoutYen: number | null; validPayoutRows: number;
};

export function binomialLowerTail(n: number, hits: number, probability: number): number {
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(hits) || hits < 0 || hits > n || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("invalid binomial inputs");
  if (hits === n || probability === 0) return 1;
  if (probability === 1) return 0;
  // Log-sum-exp prevents underflow when P(X=0) is tiny for large n.
  let logTerm = n * Math.log1p(-probability);
  let logSum = logTerm;
  for (let k = 1; k <= hits; k += 1) {
    logTerm += Math.log(n - k + 1) - Math.log(k) + Math.log(probability) - Math.log1p(-probability);
    const max = Math.max(logSum, logTerm);
    logSum = max + Math.log(Math.exp(logSum - max) + Math.exp(logTerm - max));
  }
  return Math.min(1, Math.exp(logSum));
}

const betTypes: Record<string, string> = { "3連単": "trifecta", trifecta: "trifecta", "3連複": "trio", trio: "trio", "2連単": "exacta", exacta: "exacta", "2連複": "quinella", quinella: "quinella", "拡連複": "wide", wide: "wide" };
function lanes(value: string | null, length: number): string[] | null {
  const parts = (value ?? "").split("-");
  return parts.length === length && new Set(parts).size === length && parts.every((p) => /^[1-6]$/.test(p)) ? parts : null;
}
function validProbability(p: number | null): p is number { return p != null && Number.isFinite(p) && p >= 0 && p <= 1; }
function validStake(n: number): boolean { return Number.isSafeInteger(n) && n >= 0; }

type Settled = { row: MissReviewRow; hit: boolean; pattern: "first" | "second" | "third" | "other" | null };
function summarize(rows: readonly Settled[]) {
  const invalidProbabilities = rows.filter(({ row }) => !validProbability(row.estimatedHitRate)).length;
  const expectedHits = invalidProbabilities ? null : rows.reduce((sum, { row }) => sum + row.estimatedHitRate!, 0);
  return { count: rows.length, hits: rows.filter((r) => r.hit).length, expectedHits, invalidProbabilities };
}
function money(rows: readonly Settled[], stake: (r: MissReviewRow) => number) {
  let investedYen = 0, payoutYen = 0, currentOddsPayoutYen = 0, missingPayouts = 0, missingOdds = 0, invalidStakes = 0;
  for (const { row, hit } of rows) {
    const amount = stake(row);
    if (!validStake(amount)) { invalidStakes += 1; continue; }
    investedYen += amount;
    if (amount === 0) continue;
    // Even a loss needs official settlement coverage; no odds-based fallback.
    if (!row.validPayoutRows || (hit && (row.payoutMatches !== 1 || row.officialPayoutYen == null || row.officialPayoutYen <= 0))) missingPayouts += 1;
    else if (hit) payoutYen += amount / 100 * row.officialPayoutYen!;
    if (hit) {
      if (row.currentOdds == null || !Number.isFinite(row.currentOdds) || row.currentOdds <= 0) missingOdds += 1;
      else currentOddsPayoutYen += amount * row.currentOdds;
    }
  }
  const known = missingPayouts === 0 && invalidStakes === 0;
  const oddsKnown = missingOdds === 0 && invalidStakes === 0;
  return { investedYen: invalidStakes ? null : investedYen, payoutYen: known ? payoutYen : null, roi: known && investedYen > 0 ? payoutYen / investedYen : null,
    currentOddsPayoutYen: oddsKnown ? currentOddsPayoutYen : null, currentOddsRoi: oddsKnown && investedYen > 0 ? currentOddsPayoutYen / investedYen : null,
    missingPayouts, missingOdds, invalidStakes };
}
function groups(rows: readonly Settled[], key: (r: MissReviewRow) => string) {
  const grouped = new Map<string, Settled[]>();
  for (const item of rows) { const k = key(item.row); const list = grouped.get(k) ?? []; list.push(item); grouped.set(k, list); }
  return [...grouped].map(([label, items]) => ({ label, ...summarize(items), smallSample: items.length < 30 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
}

export function buildMissReview(rows: readonly MissReviewRow[], from: string, to: string) {
  const settled: Settled[] = [];
  const excluded = { returned: 0, pending: 0, unsupportedBetType: 0, invalidSelection: 0 };
  for (const row of rows) {
    if (row.returned !== 0 || (row.officialReturned != null && row.officialReturned !== 0)) { excluded.returned += 1; continue; }
    const type = betTypes[row.betType];
    if (!type) { excluded.unsupportedBetType += 1; continue; }
    const result = lanes(row.result, 3);
    if (!result) { excluded.pending += 1; continue; }
    const selection = lanes(row.selection, type === "trifecta" || type === "trio" ? 3 : 2);
    if (!selection) { excluded.invalidSelection += 1; continue; }
    let hit = false;
    if (type === "trifecta") hit = selection.join("-") === result.join("-");
    if (type === "exacta") hit = selection.join("-") === result.slice(0, 2).join("-");
    if (type === "trio") hit = selection.every((lane) => result.includes(lane));
    if (type === "quinella") hit = selection.every((lane) => result.slice(0, 2).includes(lane));
    if (type === "wide") hit = selection.every((lane) => result.includes(lane));
    // Official winning combinations also cover ties not represented by a single trifecta string.
    if (row.payoutMatches > 0 && row.officialPayoutYen != null && row.officialPayoutYen > 0) hit = true;
    const pattern = hit ? null : type !== "trifecta" ? "other" : selection[0] !== result[0] ? "first" : selection[1] !== result[1] ? "second" : "third";
    settled.push({ row, hit, pattern });
  }
  const summary = summarize(settled);
  const lowerTailProbability = summary.count && summary.expectedHits != null ? binomialLowerTail(summary.count, summary.hits, summary.expectedHits / summary.count) : null;
  const calibration = [["0–5%", 0, .05], ["5–10%", .05, .1], ["10–20%", .1, .2], ["20%以上", .2, Infinity]].map(([label, min, max]) => {
    const items = settled.filter(({ row }) => validProbability(row.estimatedHitRate) && row.estimatedHitRate >= Number(min) && row.estimatedHitRate < Number(max));
    const s = summarize(items);
    return { label: String(label), ...s, predictedRate: s.count ? s.expectedHits! / s.count : null, actualRate: s.count ? s.hits / s.count : null };
  });
  const missPatterns = { first: 0, second: 0, third: 0, other: 0 };
  for (const item of settled) if (item.pattern) missPatterns[item.pattern] += 1;
  return {
    from, to, source: "decision_history saved BUY + official race_results / race_payouts",
    probabilityEvidence: "保存された推定率を使用。通知時点の不変スナップショットとの一致は未確認。再推定は行わない。",
    queriedBuyCount: rows.length, excluded, summary: { ...summary, lowerTailProbability,
      judgement: lowerTailProbability == null ? "判定不可" : lowerTailProbability < .05 ? "想定より明らかに悪い" : "想定の範囲内" },
    method: "二項分布 Binomial(n, sum(estimatedHitRate)/n) の下側確率。独立・同率近似であり、個別確率差や同一レースの相関は反映しない。",
    uniqueRaces: new Set(settled.map(({ row }) => row.raceId)).size,
    cohorts: groups(settled, (r) => `${r.modelVersion ?? "不明"} / ${r.runKind}`),
    calibration, missPatterns,
    conditions: {
      venue: groups(settled, (r) => r.venue),
      odds: groups(settled, (r) => r.currentOdds == null ? "未取得" : r.currentOdds < 10 ? "10倍未満" : r.currentOdds < 30 ? "10–30倍未満" : r.currentOdds < 50 ? "30–50倍未満" : "50倍以上"),
      ev: groups(settled, (r) => r.ev == null ? "未算出" : r.ev < 1 ? "1未満" : r.ev < 1.2 ? "1–1.2未満" : r.ev < 1.5 ? "1.2–1.5未満" : "1.5以上"),
      raceNo: groups(settled, (r) => `${r.raceNo}R`),
    },
    money: {
      basis: "公式払戻は100円当たり。仮想投入は保存推奨額、実購入はactually_bought=1のstake_yen。返還は対象外。",
      paper: money(settled, (r) => r.recommendedStakeYen),
      actual: money(settled.filter(({ row }) => row.actuallyBought === 1), (r) => r.stakeYen),
    },
  };
}
