import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBuyLedger } from "./accuracyScorecard";
import { buildBuyResultNotification, formatTally } from "./buyResultNotification";

test("的中は見出しだけで「当たった・いくら」がわかる", () => {
  const message = buildBuyResultNotification({
    venue: "津",
    raceNo: 6,
    betType: "trifecta",
    selection: "1-2-3",
    resultSelection: "1-2-3",
    winningPayoutYen: 1_250,
    returned: false,
    currentOdds: 14.2,
  });

  assert.equal(message.status, "hit");
  assert.equal(message.title, "✅ 的中！ 津6R 1-2-3 → 払戻 1,250円");
  assert.match(message.body, /^100円が 1,250円 に（\+1,150円）/);
  assert.match(message.body, /実着順: 1-2-3\n/);
  assert.doesNotMatch(`${message.title}\n${message.body}`, /🎯/);
});

test("はずれは見出しに買い目と結果を並べる", () => {
  const message = buildBuyResultNotification({
    venue: "丸亀",
    raceNo: 3,
    betType: "trifecta",
    selection: "1-2-3",
    resultSelection: "1-6-4",
    winningPayoutYen: 5_090,
    returned: false,
    currentOdds: 28.5,
  });

  assert.equal(message.status, "miss");
  assert.equal(message.title, "❌ はずれ 丸亀3R（買い目 1-2-3 → 結果 1-6-4）");
  assert.match(message.body, /^-100円（結果の組 1-6-4 の払戻は 5,090円）/);
  assert.match(message.body, /実着順: 1-6-4\n/);
});

test("返還は ±0円", () => {
  const message = buildBuyResultNotification({
    venue: "芦屋",
    raceNo: 1,
    betType: "trifecta",
    selection: "1-2-3",
    resultSelection: null,
    winningPayoutYen: null,
    returned: true,
    currentOdds: null,
  });

  assert.equal(message.status, "returned");
  assert.equal(message.title, "↩️ 返還 芦屋1R（100円が戻る）");
  assert.match(message.body, /^±0円/);
});

test("成績を渡すと2行目に今月と通算の勝敗・収支を出す", () => {
  const month = summarizeBuyLedger([{ date: "2026-10-01", hit: false, payoutYen: null }, { date: "2026-10-02", hit: false, payoutYen: null }]);
  const total = summarizeBuyLedger([{ date: "2026-08-01", hit: true, payoutYen: 4_270 }, { date: "2026-10-01", hit: false, payoutYen: null }]);
  assert.equal(formatTally(month), "0勝 2敗（-200円）");
  assert.equal(formatTally(total), "1勝 1敗（+4,070円）");
  const message = buildBuyResultNotification({
    venue: "常滑", raceNo: 8, betType: "3連単", selection: "1-2-3", resultSelection: "1-5-4",
    winningPayoutYen: 5_750, returned: false, currentOdds: 66.1, tally: { month, total },
  });
  assert.equal(message.body.split("\n")[1], "今月 0勝 2敗（-200円） / 通算 1勝 1敗（+4,070円）");
});

test("財布の行を渡すと、今月・通算の行の代わりに財布の行を出す", () => {
  const month = summarizeBuyLedger([{ date: "2026-10-01", hit: false, payoutYen: null }]);
  const message = buildBuyResultNotification({
    venue: "常滑", raceNo: 8, betType: "3連単", selection: "1-2-3", resultSelection: "1-5-4",
    winningPayoutYen: 5_750, returned: false, currentOdds: 66.1, tally: { month, total: month },
    bankrollLine: "🚤 2代目の財布: 9,900円（10,000円から -100円・1回 0的中）",
  });
  assert.deepEqual(message.body.split("\n").slice(0, 3), ["-100円（結果の組 1-5-4 の払戻は 5,750円）", "🚤 2代目の財布: 9,900円（10,000円から -100円・1回 0的中）", ""]);
});
