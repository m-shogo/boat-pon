/**
 * 本命予想の BUY（3代目の財布、2026-11-18〜）。
 *
 * それまでの BUY は v3 の推定で期待値が高く見える買い目（全部 1-2-3・平均 64倍）で、10/10 以降に締切前に通知できた 43 件は 0 的中だった。
 * 11/15 の「判断の日」の比較（BUY 0%・本命予想 87%）と、ユーザーの委任（2026-11-16）で、BUY を「市場補正の確率がいちばん高い買い目」に置き換えた。
 * 根拠と事前登録: docs/reviews/2026-11-16-favorite-buy-preregistration.md（知識ベース K13〜K17）。
 *
 * 変えたのは「どの買い目を BUY にするか」だけ。記録（decision_history）の形・通知・速報・財布・スコアカードは同じ経路を通る。
 * estimated_hit_rate には、これまでどおり v3 のその買い目の推定が入る（v3 と市場補正の比較を続けるため）。
 * 購入の推奨ではない（paper）。7/1〜10/28 に同じ決まり（T-10 → T-5 の順・1日 2 件まで）を当てはめた再生では、BUY 193 件・
 * 的中 22.0%（見込み 26.2%）・回収率 86.0%（月別 39%・90%・121%・80%）。閾値を選んだ期間の数字で、プラスの見込みではない。
 *
 * 閾値は事前登録した値で固定する。変えるときは判定の変更として、同じコミットで財布（src/domain/bankroll.ts の WALLETS）に次の代を足す。
 */
import { REALTIME_NOTIFY_CHECKPOINTS } from "./buyNotification";
import type { FavoritePick } from "./favoritePick";
import type { Decision } from "./types";

export const FAVORITE_BUY = {
  /** この日（JST）のレースから有効。前の日までは v3 の BUY のまま。 */
  from: "2026-11-18",
  /** 市場補正の確率がこれ以上の本命だけを BUY にする。 */
  minProbability: 0.22,
  /** 1日の上限（LINE の月 200 通の枠: BUY 2 + 結果 2 + 日次 1 = 1日 5 通まで）。 */
  maxBuyCountPerDay: 2,
  /** 通知が間に合う余裕（締切の何分前まで）。通知は締切 5 分前を過ぎると送らないので、判定から送信までの分として 1 分早く締める。 */
  minMinutesBeforeClose: 6,
  /** これより前は市場がまだ固まっていないので判定しない（T-10 の窓の上限）。 */
  maxMinutesBeforeClose: 15,
} as const;

export type FavoriteBuyRule = typeof FAVORITE_BUY;

export function favoriteBuyActive(date: string, rule: Pick<FavoriteBuyRule, "from"> = FAVORITE_BUY): boolean {
  return date >= rule.from;
}

/** そのレースで本命予想を判定する時間帯か（締切 6〜15 分前。ここだけオッズの全 120 通りを読む）。 */
export function isFavoriteBuyWindow(minutesBeforeClose: number | null, rule: Pick<FavoriteBuyRule, "minMinutesBeforeClose" | "maxMinutesBeforeClose"> = FAVORITE_BUY): boolean {
  return minutesBeforeClose != null && minutesBeforeClose >= rule.minMinutesBeforeClose && minutesBeforeClose <= rule.maxMinutesBeforeClose;
}

export type FavoriteBuyInput = {
  /** 最新の全 120 通りのオッズから選んだ本命。オッズがそろっていなければ null。 */
  pick: Pick<FavoritePick, "selection" | "probability" | "t5Odds"> | null;
  /** 最新のオッズのチェックポイント（T-10 / T-5 のときだけ BUY にする）。 */
  latestCheckpointLabel: string | null;
  minutesBeforeClose: number | null;
  /** 今日すでに BUY にした件数（固定済みを含む）。 */
  buyCountToday: number;
  /** v3 の候補にその買い目があるか（記録に v3 の推定を残すため。無ければ BUY にしない）。 */
  hasCandidate: boolean;
  stakeYen: number;
};

const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`;

/** 本命予想を BUY にするか。BUY でなければ SKIP と理由を返す（呼び出し側は v3 の判定を記録し、この理由を足す）。 */
export function judgeFavoriteBuy(input: FavoriteBuyInput, rule: FavoriteBuyRule = FAVORITE_BUY): Decision {
  const skip = (reason: string, pick = input.pick): Decision => ({
    status: "SKIP",
    requiredOdds: pick && pick.probability > 0 ? 1 / pick.probability : Number.POSITIVE_INFINITY,
    ev: pick ? pick.probability * pick.t5Odds : null,
    recommendedAmount: 0,
    reasons: [`本命予想は見送り: ${reason}`],
  });
  if (!isFavoriteBuyWindow(input.minutesBeforeClose, rule)) return skip(`締切 ${rule.minMinutesBeforeClose}〜${rule.maxMinutesBeforeClose} 分前ではない`);
  if (!input.pick) return skip("全 120 通りのオッズがそろっていない");
  if (input.latestCheckpointLabel == null || !REALTIME_NOTIFY_CHECKPOINTS.has(input.latestCheckpointLabel)) {
    return skip(`最新のオッズが T-10・T-5 ではない（${input.latestCheckpointLabel ?? "-"}）`);
  }
  if (!(input.pick.probability >= rule.minProbability)) return skip(`確率 ${(input.pick.probability * 100).toFixed(2)}% が基準 ${pct1(rule.minProbability)} 未満`);
  if (!input.hasCandidate) return skip(`v3 の候補に ${input.pick.selection} が無い`);
  if (input.buyCountToday >= rule.maxBuyCountPerDay) return skip(`1日の上限 ${rule.maxBuyCountPerDay} 件に到達`);
  return {
    status: "BUY",
    // 期待回収が 100% になるオッズ（＝ 1 ÷ 確率）
    requiredOdds: 1 / input.pick.probability,
    // 期待回収（確率 × 判定時のオッズ）。1 未満がふつう（控除率 25% の内側）
    ev: input.pick.probability * input.pick.t5Odds,
    recommendedAmount: input.stakeYen,
    reasons: [`本命予想: 市場補正の確率 ${pct1(input.pick.probability)}（基準 ${pct1(rule.minProbability)} 以上）`],
  };
}

export const V3_BUY_NOT_NOTIFIED_REASON = "v3 の BUY 条件（3代目からは通知しない。記録だけ）";

/** 本命予想に置き換えた後の v3 の判定。BUY は WATCH に下げて記録だけ残す（v3 の BUY なら何を買っていたかを後から数えられる）。 */
export function demoteV3Decision(decision: Decision): Decision {
  if (decision.status !== "BUY") return decision;
  return { ...decision, status: "WATCH", recommendedAmount: 0, reasons: [V3_BUY_NOT_NOTIFIED_REASON] };
}

/** 本命予想を見送ったレースの記録: v3 の判定（BUY は下げる）に、見送りの理由を足す。 */
export function mergeSkippedFavorite(v3Decision: Decision, favoriteDecision: Decision): Decision {
  const demoted = demoteV3Decision(v3Decision);
  return { ...demoted, reasons: [...demoted.reasons, ...favoriteDecision.reasons] };
}
