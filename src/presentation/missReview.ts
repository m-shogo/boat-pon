/** Read-only analysis of saved BUY probabilities and official settlement. */
export type MissReviewRow = {
  id: number; raceId: string; venue: string; raceNo: number; betType: string; selection: string;
  result: string | null; returned: number; officialReturned: number | null;
  estimatedHitRate: number | null; currentOdds: number | null; ev: number | null;
  recommendedStakeYen: number; actuallyBought: number; stakeYen: number;
  modelVersion: string | null; runKind: string;
  payoutMatches: number; officialPayoutYen: number | null; validPayoutRows: number;
};

export function poissonBinomialLowerTail(probabilities: readonly number[], hits: number): number {
  if (!Number.isSafeInteger(hits) || hits < 0 || hits > probabilities.length || probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("invalid Poisson binomial inputs");
  // DP stores P(X=k); descending updates preserve the previous trial's values.
  const dp = Array<number>(hits + 1).fill(0);
  dp[0] = 1;
  for (const p of probabilities) {
    for (let k = hits; k >= 0; k -= 1) dp[k] = dp[k] * (1 - p) + (k ? dp[k - 1] * p : 0);
  }
  return Math.min(1, dp.reduce((sum, p) => sum + p, 0));
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
    // A confirmed loss settles at zero; only winners require official payout coverage.
    if (hit && (!row.validPayoutRows || row.payoutMatches !== 1 || row.officialPayoutYen == null || !Number.isFinite(row.officialPayoutYen) || row.officialPayoutYen <= 0)) missingPayouts += 1;
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
  const unique = new Map<string, MissReviewRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.raceId, row.betType, row.selection]);
    // The latest decision_history id represents each (race_id, bet_type, selection).
    const previous = unique.get(key);
    if (!previous || row.id > previous.id) unique.set(key, row);
  }
  for (const row of unique.values()) {
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
  const races = new Map<string, { probability: number; hit: boolean }>();
  for (const { row, hit } of settled) {
    const race = races.get(row.raceId) ?? { probability: 0, hit: false };
    race.probability = Math.min(1, race.probability + (validProbability(row.estimatedHitRate) ? row.estimatedHitRate : 0));
    race.hit ||= hit;
    races.set(row.raceId, race);
  }
  const raceHits = [...races.values()].filter((r) => r.hit).length;
  const raceExpectedHits = summary.invalidProbabilities ? null : [...races.values()].reduce((sum, r) => sum + r.probability, 0);
  const lowerTailProbability = races.size && !summary.invalidProbabilities ? poissonBinomialLowerTail([...races.values()].map((r) => r.probability), raceHits) : null;
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
    queriedBuyCount: rows.length, deduplicatedBuyCount: unique.size, excluded, raceSummary: { count: races.size, hits: raceHits, expectedHits: raceExpectedHits }, summary: { ...summary, lowerTailProbability,
      judgement: lowerTailProbability == null ? "判定不可" : lowerTailProbability < .05 ? "想定より明らかに悪い" : "想定の範囲内" },
    method: "同一レースの推定率を合算（上限1）し、レース間の独立を仮定したPoisson二項分布の下側確率を動的計画法で厳密計算。実的中もレース内でどれか的中を1件とする。券種間の重なりは合算で近似。",
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
