import assert from "node:assert/strict";
import test from "node:test";
import { computeBankroll, computeWallets, formatBankrollLine, formatWalletLines, startedWallets, type Wallet } from "./bankroll";

const first: Wallet = { generation: 1, from: "2026-07-20", startYen: 10_000, stakeYen: 100, note: "test" };
const second: Wallet = { generation: 2, from: "2026-10-10", startYen: 10_000, stakeYen: 100, note: "test" };
const bet = (date: string, hit: boolean | null, payoutYen: number | null = null, time = "12:00") => ({ order: `${date} ${time}`, date, hit, payoutYen });

test("1万円から、BUY ごとに100円払い、的中で払戻を足す。結果待ちは払ったまま。最低は払戻を足す前で見る", () => {
  const b = computeBankroll([
    bet("2026-10-09", true, 5_000), // 代の前は数えない
    bet("2026-10-10", false),
    bet("2026-10-12", true, 4_270),
    bet("2026-10-11", false),
    bet("2026-10-15", null),
  ], second);
  assert.equal(b.bets, 4);
  assert.equal(b.hits, 1);
  assert.equal(b.pending, 1);
  assert.equal(b.balanceYen, 10_000 - 400 + 4_270);
  assert.equal(b.changeYen, 3_870);
  assert.equal(b.troughYen, 9_700);
  assert.equal(b.peakYen, 13_970);
  assert.equal(b.balanceAt("2026-10-11"), 9_800);
  assert.equal(b.balanceAt("2026-10-09"), 10_000);
  assert.equal(formatBankrollLine(b), "🚤 2代目の財布: 13,870円（10,000円から +3,870円・4回 1的中・結果待ち 1件）");
});

test("最初の BUY が的中しても、最低の資産は買った直後の 9,900円（Codex のレビュー）", () => {
  const b = computeBankroll([bet("2026-10-10", true, 1_000)], second);
  assert.equal(b.troughYen, 9_900);
  assert.equal(b.balanceYen, 10_900);
});

test("返還は 100円が戻る（結果待ちにしない。Codex のレビュー）", () => {
  const b = computeBankroll([{ ...bet("2026-10-10", null), returned: true }], second);
  assert.equal(b.balanceYen, 10_000);
  assert.equal(b.returns, 1);
  assert.equal(b.pending, 0);
});

test("0円を割っても止めずに、マイナスで数える", () => {
  const b = computeBankroll(Array.from({ length: 105 }, (_, i) => bet("2026-10-10", false, null, String(i).padStart(3, "0"))), second);
  assert.equal(b.balanceYen, -500);
  assert.equal(b.troughYen, -500);
  assert.equal(formatWalletLines(b)[0], "🚤 2代目（現役・10/10〜）: -500円（10,000円から -10,500円）");
});

test("代ごとに財布を分ける: 前の代は次の代が始まる前の日で引退し、最後の資産のまま残る", () => {
  const bets = [bet("2026-08-01", false), bet("2026-10-09", false), bet("2026-10-10", false), bet("2026-10-11", true, 2_000)];
  const [old, now] = computeWallets(bets, "2026-10-15", [first, second]);
  assert.equal(old.retired, true);
  assert.equal(old.to, "2026-10-09");
  assert.equal(old.balanceYen, 9_800);
  assert.equal(now.retired, false);
  assert.equal(now.balanceYen, 11_800);
  assert.deepEqual(formatWalletLines(old), ["⚓ 初代（引退・7/20〜10/9）: 9,800円（10,000円から -200円）", "　2回 0的中／最高 10,000円・最低 9,800円"]);
  assert.equal(formatWalletLines(now)[0], "🚤 2代目（現役・10/10〜）: 11,800円（10,000円から +1,800円）");

  // BUY の判定が変わって3代目を足したら、その日から 1万円で始まり、2代目は引退する
  const third: Wallet = { generation: 3, from: "2026-11-16", startYen: 10_000, stakeYen: 100, note: "本命予想に置き換え" };
  assert.equal(startedWallets("2026-11-15", [first, second, third]).length, 2);
  const wallets = computeWallets([...bets, bet("2026-11-16", false)], "2026-11-20", [first, second, third]);
  assert.deepEqual(wallets.map((w) => [w.wallet.generation, w.retired, w.balanceYen]), [[1, true, 9_800], [2, true, 11_800], [3, false, 9_900]]);
});
