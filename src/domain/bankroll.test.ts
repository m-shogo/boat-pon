import assert from "node:assert/strict";
import test from "node:test";
import { computeBankroll, currentSeason, formatBankrollLine, type BankrollSeason } from "./bankroll";

const season: BankrollSeason = { id: 1, from: "2026-10-10", startYen: 10_000, stakeYen: 100, note: "test" };

test("1万円から、BUY ごとに100円払い、的中で払戻を足す。結果待ちは払ったまま", () => {
  const b = computeBankroll([
    { order: "2026-10-09 10:00", date: "2026-10-09", hit: true, payoutYen: 5_000 }, // 期の前は数えない
    { order: "2026-10-10 11:00", date: "2026-10-10", hit: false, payoutYen: null },
    { order: "2026-10-12 12:00", date: "2026-10-12", hit: true, payoutYen: 4_270 },
    { order: "2026-10-11 09:00", date: "2026-10-11", hit: false, payoutYen: null },
    { order: "2026-10-15 16:48", date: "2026-10-15", hit: null, payoutYen: null },
  ], season);
  assert.equal(b.bets, 4);
  assert.equal(b.hits, 1);
  assert.equal(b.pending, 1);
  assert.equal(b.balanceYen, 10_000 - 400 + 4_270);
  assert.equal(b.changeYen, 3_870);
  assert.equal(b.troughYen, 9_800);
  assert.equal(b.peakYen, 13_970);
  assert.equal(b.balanceAt("2026-10-11"), 9_800);
  assert.equal(b.balanceAt("2026-10-09"), 10_000);
  assert.equal(formatBankrollLine(b), "💴 資産 13,870円（第1期 10,000円スタートから +3,870円・最高 13,970円・最低 9,800円・4回 1的中・結果待ち 1件）");
});

test("BUY の判定が変わって新しい期を足したら、その日から1万円でやり直す", () => {
  const seasons: BankrollSeason[] = [season, { id: 2, from: "2026-11-16", startYen: 10_000, stakeYen: 100, note: "本命予想に置き換え" }];
  assert.equal(currentSeason("2026-11-15", seasons).id, 1);
  assert.equal(currentSeason("2026-11-16", seasons).id, 2);
  const b = computeBankroll([{ order: "2026-11-01", date: "2026-11-01", hit: false, payoutYen: null }], currentSeason("2026-11-20", seasons));
  assert.equal(b.balanceYen, 10_000);
  assert.equal(b.bets, 0);
});
