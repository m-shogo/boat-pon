import assert from "node:assert/strict";
import test from "node:test";
import { pickFavorite } from "./favoritePick";

test("本命予想は、市場補正の確率がいちばん高い買い目1点（同じなら人気・文字列順で決める）", () => {
  const odds = new Map([["1-2-3", 4.5], ["1-3-2", 6.0], ["2-1-3", 12.0], ["3-1-2", 4.5]]);
  const pick = pickFavorite("20261015-芦屋-06", odds, null, { temperature: 0.9, lateMoneyBeta: 0.25 });
  assert.equal(pick?.selection, "1-2-3");
  assert.equal(pick?.t5Odds, 4.5);
  // 直前の動き（オッズが下がった＝人気が集まった）があれば、そちらが本命になりうる
  const earlier = new Map([["1-2-3", 4.5], ["1-3-2", 9.0], ["2-1-3", 12.0], ["3-1-2", 4.5]]);
  const moved = pickFavorite("r", new Map([["1-2-3", 4.6], ["1-3-2", 4.7], ["2-1-3", 12.0], ["3-1-2", 4.6]]), earlier, { temperature: 0.9, lateMoneyBeta: 0.25 });
  assert.equal(moved?.selection, "1-3-2");
});
