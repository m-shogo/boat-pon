import assert from "node:assert/strict";
import test from "node:test";
import { FAVORITE_BUY, demoteV3Decision, favoriteBuyActive, isFavoriteBuyWindow, judgeFavoriteBuy, mergeSkippedFavorite, V3_BUY_NOT_NOTIFIED_REASON, type FavoriteBuyInput } from "./favoriteBuy";
import { WALLETS } from "./bankroll";

const base: FavoriteBuyInput = {
  pick: { selection: "1-2-3", probability: 0.254, t5Odds: 3.5 },
  latestCheckpointLabel: "T-10",
  minutesBeforeClose: 11,
  buyCountToday: 0,
  hasCandidate: true,
  stakeYen: 100,
};

test("本命予想: 確率が基準以上・T-10/T-5・締切 6〜15 分前・上限内なら BUY", () => {
  const decision = judgeFavoriteBuy(base);
  assert.equal(decision.status, "BUY");
  assert.equal(decision.recommendedAmount, 100);
  // 期待回収 = 確率 × オッズ（1 未満でも BUY。期待値ではなく確率で選ぶ）
  assert.ok(Math.abs(decision.ev! - 0.254 * 3.5) < 1e-9);
  assert.ok(Math.abs(decision.requiredOdds - 1 / 0.254) < 1e-9);
  assert.deepEqual(decision.reasons, ["本命予想: 市場補正の確率 25.4%（基準 22.0% 以上）"]);
  assert.equal(judgeFavoriteBuy({ ...base, latestCheckpointLabel: "T-5", minutesBeforeClose: 6 }).status, "BUY");
});

test("本命予想: 基準ちょうどは BUY、わずかに下は見送り", () => {
  assert.equal(judgeFavoriteBuy({ ...base, pick: { ...base.pick!, probability: FAVORITE_BUY.minProbability } }).status, "BUY");
  const below = judgeFavoriteBuy({ ...base, pick: { ...base.pick!, probability: 0.2199 } });
  assert.equal(below.status, "SKIP");
  assert.equal(below.recommendedAmount, 0);
  assert.equal(below.reasons[0], "本命予想は見送り: 確率 21.99% が基準 22.0% 未満");
});

test("本命予想: 見送りの理由（時間帯・オッズ不足・チェックポイント・候補なし・1日の上限）", () => {
  const reason = (input: Partial<FavoriteBuyInput>) => {
    const decision = judgeFavoriteBuy({ ...base, ...input });
    assert.equal(decision.status, "SKIP");
    return decision.reasons[0];
  };
  assert.match(reason({ minutesBeforeClose: 5.9 }), /締切 6〜15 分前ではない/);
  assert.match(reason({ minutesBeforeClose: 15.1 }), /締切 6〜15 分前ではない/);
  assert.match(reason({ minutesBeforeClose: null }), /締切 6〜15 分前ではない/);
  assert.match(reason({ pick: null }), /全 120 通りのオッズがそろっていない/);
  assert.match(reason({ latestCheckpointLabel: "T-20" }), /T-10・T-5 ではない（T-20）/);
  assert.match(reason({ latestCheckpointLabel: null }), /T-10・T-5 ではない（-）/);
  assert.match(reason({ hasCandidate: false }), /v3 の候補に 1-2-3 が無い/);
  assert.match(reason({ buyCountToday: FAVORITE_BUY.maxBuyCountPerDay }), /1日の上限 2 件に到達/);
  // 確率が NaN でも BUY にしない
  assert.equal(judgeFavoriteBuy({ ...base, pick: { ...base.pick!, probability: Number.NaN } }).status, "SKIP");
});

test("本命予想: 有効になる日と時間帯", () => {
  assert.equal(favoriteBuyActive("2026-11-17"), false);
  assert.equal(favoriteBuyActive("2026-11-18"), true);
  assert.equal(isFavoriteBuyWindow(6), true);
  assert.equal(isFavoriteBuyWindow(15), true);
  assert.equal(isFavoriteBuyWindow(5.99), false);
  assert.equal(isFavoriteBuyWindow(null), false);
});

test("本命予想に置き換えた後、v3 の BUY は WATCH に下げて記録だけ残す", () => {
  const v3Buy = { status: "BUY" as const, requiredOdds: 20, ev: 3.9, recommendedAmount: 100, reasons: ["EV条件を満たす"] };
  const demoted = demoteV3Decision(v3Buy);
  assert.equal(demoted.status, "WATCH");
  assert.equal(demoted.recommendedAmount, 0);
  assert.deepEqual(demoted.reasons, [V3_BUY_NOT_NOTIFIED_REASON]);
  // v3 の EV は残す（後から「v3 なら何を買っていたか」を数えられる）
  assert.equal(demoted.ev, 3.9);
  const skip = { status: "SKIP" as const, requiredOdds: 20, ev: 0.4, recommendedAmount: 0, reasons: ["EVが低い"] };
  assert.equal(demoteV3Decision(skip), skip);
  const merged = mergeSkippedFavorite(v3Buy, judgeFavoriteBuy({ ...base, pick: { ...base.pick!, probability: 0.1 } }));
  assert.equal(merged.status, "WATCH");
  assert.equal(merged.reasons.length, 2);
  assert.match(merged.reasons[1], /^本命予想は見送り: /);
});

test("判定を変えた日に、財布の次の代が始まる（CLAUDE.md の決まり）", () => {
  const third = WALLETS.find((w) => w.generation === 3);
  assert.ok(third, "3代目の財布が要る");
  assert.equal(third.from, FAVORITE_BUY.from);
  assert.equal(third.startYen, 10_000);
  assert.equal(third.stakeYen, 100);
});
