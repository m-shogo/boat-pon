/**
 * 3連単の BUY の当たり外れを「買い目ごと」に決める（通知・財布・スコアカードが同じ決め方を使う）。
 *
 * 以前は結果表（race_results）の 1 行だけで決めていた。その「返還」の印は、ほかの券種の特払い・不成立でも付くので、
 * 3連単がふつうに確定したレースの BUY まで「返還」と数えた。同着の 2 つ目の当たりは「外れ」と数えた
 * （2026-11-17 の調査: docs/reviews/2026-11-17-payout-history-reparse.md。それまでの成績への影響は 0 件）。
 *
 * 決め方（公式のルールどおり）:
 * - 買い目に、フライング・出遅れ・欠場の艇が入っていれば返還（100 円が戻る）
 * - 3連単が成立しなかったレース（レース不成立など）は、全部の買い目が返還
 * - 3連単の払戻の行（同着なら 2 つ）に買い目があれば的中。無ければ外れ
 * - 確定結果がまだ無ければ結果待ち
 */
export type TrifectaFacts = {
  /** 3連単の払戻の行。同着なら 2 つ。確定結果がまだ無ければ空。 */
  winners: Array<{ combination: string; payoutYen: number | null }>;
  /** 返還になる艇（フライング・出遅れ・欠場）。各艇の成績がまだ無いときは null（わからない）。 */
  refundBoats: number[] | null;
  /** レースは確定したが、3連単が成立しなかった（全部の買い目が返還）。 */
  voided: boolean;
  /** 結果表の古い「返還」の印。各艇の成績が無いときだけ使う（その場合は買い目ごとに分けられないので、以前と同じく返還にする）。 */
  legacyReturned: boolean;
};

export type BuySettlement = {
  status: "hit" | "miss" | "returned" | "pending";
  /** 的中のときの払戻（100 円あたり）。同着の速報などで払戻がわからないときは null。 */
  payoutYen: number | null;
  /** 通知に出す実着順。的中なら買い目、外れ・返還なら 1 つ目の確定組番（無ければ null）。 */
  resultSelection: string | null;
};

export const NO_TRIFECTA_FACTS: TrifectaFacts = { winners: [], refundBoats: null, voided: false, legacyReturned: false };

/** 返還になる着順の記号: F（フライング）・L0/L1（出遅れ）・K0/K1（欠場）。S0/S1/S2（失格・転覆など）は返還にならない。 */
export function isRefundStatus(statusCode: string | null | undefined): boolean {
  return statusCode != null && /^[FLK]/.test(statusCode);
}

/**
 * 各艇の成績（race_entries）から、返還になる艇を出す。行が 1 つも無ければ null（まだ取り込んでいない）。
 * 欠場と、進入の無い出遅れの艇は K ファイルの行の形が違い、race_entries に入らない（2010 年以降の読めない行 8,602 のうち 8,601 がこの 2 つ）。
 * そこで、1〜6 号艇のうち行の無い艇も返還の艇として扱う。
 */
export function refundBoatsFromEntries(entries: Array<{ boat: number; statusCode: string | null }>): number[] | null {
  if (entries.length === 0) return null;
  const present = new Set(entries.map((e) => e.boat));
  const refund = new Set(entries.filter((e) => isRefundStatus(e.statusCode)).map((e) => e.boat));
  for (let boat = 1; boat <= 6; boat += 1) if (!present.has(boat)) refund.add(boat);
  return [...refund].sort((a, b) => a - b);
}

export function settleTrifectaBuy(selection: string, facts: TrifectaFacts): BuySettlement {
  const first = facts.winners[0]?.combination ?? null;
  const boats = selection.split("-").map(Number);
  if (facts.refundBoats != null && boats.some((boat) => facts.refundBoats!.includes(boat))) {
    return { status: "returned", payoutYen: null, resultSelection: first };
  }
  if (facts.voided) return { status: "returned", payoutYen: null, resultSelection: null };
  const winner = facts.winners.find((w) => w.combination === selection);
  if (winner) return { status: "hit", payoutYen: winner.payoutYen, resultSelection: selection };
  // 各艇の成績が無く、買い目ごとに分けられないとき: 古い印に従う（以前と同じ扱い）
  if (facts.refundBoats == null && facts.legacyReturned) return { status: "returned", payoutYen: null, resultSelection: first };
  if (first == null) return { status: "pending", payoutYen: null, resultSelection: null };
  return { status: "miss", payoutYen: facts.winners[0].payoutYen, resultSelection: first };
}

/**
 * 速報の通知文（scripts/notify-buy-results-fast.ts が notification_log に残したもの）から、その時点の結論を読む。
 * 確定結果がまだ無いときの代わりと、確定通知を省いてよいか（速報と同じ結論か）の判定に使う。
 */
export function parseFastResultNotification(title: string | null | undefined, body: string | null | undefined): BuySettlement | null {
  if (!title || !body) return null;
  const actual = body.match(/実着順: (\d-\d-\d)(?:\n|$)/)?.[1] ?? null;
  if (title.startsWith("↩️")) return { status: "returned", payoutYen: null, resultSelection: actual };
  const selection = body.match(/買い目: (\d-\d-\d)/)?.[1] ?? null;
  if (!actual || !selection) return null;
  const payout = title.match(/払戻 ([\d,]+)円/)?.[1];
  return actual === selection
    ? { status: "hit", payoutYen: payout ? Number(payout.replaceAll(",", "")) : null, resultSelection: actual }
    : { status: "miss", payoutYen: null, resultSelection: actual };
}

/** 確定の結論があればそれを、無ければ速報の結論を使う。 */
export function settlementOrFast(confirmed: BuySettlement, fast: BuySettlement | null): BuySettlement {
  return confirmed.status === "pending" && fast ? fast : confirmed;
}

/**
 * 成績の集計（summarizeBuyLedger）と財布（computeWallets）に渡す形にする。
 * 返還と結果待ちは hit=null（未精算）。的中でも払戻がわからないもの（同着の速報など）は未精算のままにする。
 */
export function toBuyOutcome(date: string, settlement: BuySettlement): { date: string; hit: boolean | null; payoutYen: number | null; returned: boolean } {
  if (settlement.status === "returned") return { date, hit: null, payoutYen: null, returned: true };
  if (settlement.status === "miss") return { date, hit: false, payoutYen: null, returned: false };
  if (settlement.status === "hit" && settlement.payoutYen != null) return { date, hit: true, payoutYen: settlement.payoutYen, returned: false };
  return { date, hit: null, payoutYen: null, returned: false };
}
