import assert from "node:assert/strict";
import test from "node:test";
import {
  accuracySnapshotFromReport, binaryMetrics, calibratedMarketProbabilities, describeBuyProbability, evaluateChallenger, evaluateDataFreshness, evaluateJobLiveness, fitMarketCalibration,
  classifyBuyTiming, formatLedgerAndAccuracyLines, multiclassLogLoss, normalizedMarketProbabilities, parseDbTimestamp, summarizeBuyLedger, type MarketRace,
} from "./accuracyScorecard";

test("binaryMetrics は期待的中数・Brier・logloss を出す", () => {
  const result = binaryMetrics([{ p: 0.5, hit: 1 }, { p: 0.5, hit: 0 }]);
  assert.equal(result.n, 2);
  assert.equal(result.hits, 1);
  assert.equal(result.expectedHits, 1);
  assert.equal(result.actualToPredicted, 1);
  assert.equal(result.brier, 0.25);
  assert.ok(Math.abs((result.logLoss ?? 0) - Math.log(2)) < 1e-12);
});

test("binaryMetrics は空入力で null を返す", () => {
  const result = binaryMetrics([]);
  assert.equal(result.n, 0);
  assert.equal(result.brier, null);
  assert.equal(result.actualToPredicted, null);
});

test("市場確率は控除分を除いて合計1になる", () => {
  const p = normalizedMarketProbabilities(new Map([["1-2-3", 2], ["2-1-3", 4]]))!;
  assert.ok(Math.abs([...p.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(p.get("1-2-3")! - 2 / 3) < 1e-12);
});

test("1倍以下や非数のオッズがあれば市場確率は null", () => {
  assert.equal(normalizedMarketProbabilities(new Map([["1-2-3", 1], ["2-1-3", 4]])), null);
  assert.equal(normalizedMarketProbabilities(new Map([["1-2-3", Number.NaN]])), null);
});

test("temperature<1 は本命を、late money は直前に買われた買い目を引き上げる", () => {
  const t5 = new Map([["1-2-3", 2], ["2-1-3", 4]]);
  const base = normalizedMarketProbabilities(t5)!;
  const tempOnly = calibratedMarketProbabilities(t5, null, { temperature: 0.9, lateMoneyBeta: 0 })!;
  assert.ok(tempOnly.get("1-2-3")! > base.get("1-2-3")!);
  const earlier = new Map([["1-2-3", 2], ["2-1-3", 8]]);
  const withMomentum = calibratedMarketProbabilities(t5, earlier, { temperature: 1, lateMoneyBeta: 0.5 })!;
  assert.ok(withMomentum.get("2-1-3")! > base.get("2-1-3")!);
  assert.ok(Math.abs([...withMomentum.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("BUY 台帳は未精算を ROI の分母に入れない", () => {
  const summary = summarizeBuyLedger([
    { date: "2026-09-01", hit: true, payoutYen: 4000 },
    { date: "2026-09-02", hit: false, payoutYen: null },
    { date: "2026-10-01", hit: null, payoutYen: null },
  ]);
  assert.equal(summary.buys, 3);
  assert.equal(summary.settled, 2);
  assert.equal(summary.hits, 1);
  assert.equal(summary.misses, 1);
  assert.equal(summary.officialRoi, 20);
  assert.deepEqual(summary.byMonth.map((m) => [m.month, m.settled, m.officialRoi]), [["2026-09", 2, 20], ["2026-10", 0, null]]);
});

const favouriteWins = (date: string): MarketRace => ({ date, winner: "1-2-3", t5Odds: new Map([["1-2-3", 2], ["2-1-3", 4]]), earlierOdds: null });

test("本命が勝ち続けるデータでは temperature<1 の方が logloss が小さい", () => {
  const races = Array.from({ length: 20 }, (_, i) => favouriteWins(`2026-09-${String(i + 1).padStart(2, "0")}`));
  const flat = multiclassLogLoss(races, { temperature: 1, lateMoneyBeta: 0 })!;
  const sharp = multiclassLogLoss(races, { temperature: 0.8, lateMoneyBeta: 0 })!;
  assert.ok(sharp < flat);
  assert.equal(fitMarketCalibration(races).temperature, 0.8);
});

test("挑戦者は改善幅と週ごとの勝ち数の両方を満たしたときだけ入れ替わる", () => {
  const week = Array.from({ length: 60 }, (_, i) => favouriteWins(`2026-09-${String((i % 28) + 1).padStart(2, "0")}`));
  const blocks = [week, week, week, week];
  const result = evaluateChallenger({ temperature: 1, lateMoneyBeta: 0 }, { temperature: 0.8, lateMoneyBeta: 0 }, blocks);
  assert.equal(result.weeklyWins, 4);
  assert.equal(result.promote, true);
  const same = evaluateChallenger({ temperature: 1, lateMoneyBeta: 0 }, { temperature: 1, lateMoneyBeta: 0 }, blocks);
  assert.equal(same.promote, false);
  const tooSmall = evaluateChallenger({ temperature: 1, lateMoneyBeta: 0 }, { temperature: 0.8, lateMoneyBeta: 0 }, [week.slice(0, 10)]);
  assert.equal(tooSmall.eligibleWeeks, 0);
  assert.equal(tooSmall.promote, false);
});

test("スコアカード JSON から精度の要点を取り出し、古ければ LINE に載せない", () => {
  const report = {
    generatedAt: "2026-10-07T13:00:00.000Z",
    accuracy: {
      all: [{ key: "v3", metrics: { logLoss: 0.2353 } }, { key: "calibrated", metrics: { logLoss: 0.2187 } }],
      buyOnly: [{ key: "v3", metrics: { actualToPredicted: 0.31 } }],
    },
  };
  const snapshot = accuracySnapshotFromReport(report)!;
  assert.equal(snapshot.v3BuyActualToPredicted, 0.31);
  assert.equal(accuracySnapshotFromReport({ generatedAt: 1 }), null);
  const ledger = summarizeBuyLedger([{ date: "2026-10-01", hit: false, payoutYen: null }, { date: "2026-10-02", hit: null, payoutYen: null }]);
  const freshLines = formatLedgerAndAccuracyLines(ledger, snapshot, new Date("2026-10-08T12:00:00.000Z"));
  assert.equal(freshLines.length, 2);
  assert.match(freshLines[0], /結果待ち 1/);
  assert.match(freshLines[1], /0\.31（1 が正確）/);
  assert.equal(formatLedgerAndAccuracyLines(ledger, snapshot, new Date("2026-10-10T12:00:00.000Z")).length, 1);
});

test("BUY 通知の確率行は市場補正の確率と期待回収率を出す", () => {
  const line = describeBuyProbability({
    selection: "1-2-3", v3HitRate: 0.06, quoteOdds: 60,
    latestOdds: new Map([["1-2-3", 50], ["2-1-3", 1.1]]), earlierOdds: null, params: { temperature: 1, lateMoneyBeta: 0 },
  })!;
  assert.match(line, /^的中確率: v3 6\.0% → 市場補正 2\.2% \/ 期待回収 1\.29$/);
  assert.equal(describeBuyProbability({ selection: "9-9-9", v3HitRate: null, quoteOdds: null, latestOdds: new Map([["1-2-3", 2]]), earlierOdds: null }), null);
});

test("データの鮮度: 払戻だけ止まっている状態と、今日の番組表が無い状態を見つける", () => {
  const ok = evaluateDataFreshness({ today: "2026-10-08", resultsMaxDate: "2026-10-07", payoutsMaxDate: "2026-10-07", programsMaxDate: "2026-10-08" });
  assert.deepEqual(ok, []);
  const stale = evaluateDataFreshness({ today: "2026-10-08", resultsMaxDate: "2026-10-06", payoutsMaxDate: "2026-06-01", programsMaxDate: "2026-10-07" });
  assert.equal(stale.length, 2);
  assert.match(stale[0], /race_payouts.*2026-06-01/);
  assert.match(stale[1], /今日の分が無い/);
  assert.match(evaluateDataFreshness({ today: "2026-10-08", resultsMaxDate: "2026-10-01", payoutsMaxDate: "2026-10-01", programsMaxDate: "2026-10-08" })[0], /3日を超えて/);
});

test("ジョブの生存確認: 想定間隔を超えたものと、必須なのにログが無いものだけを警告する", () => {
  const result = evaluateJobLiveness([
    { job: "auto-odds", ageMinutes: 4, maxAgeMinutes: 30 },
    { job: "daily-results", ageMinutes: 60 * 50, maxAgeMinutes: 60 * 26 },
    { job: "buy-results-fast", ageMinutes: null, maxAgeMinutes: 60, optional: true },
    { job: "daily-notify", ageMinutes: null, maxAgeMinutes: 60 * 26 },
  ]);
  assert.deepEqual(result.rows.map((r) => r.status), ["稼働", "停止の疑い", "未登録", "ログなし"]);
  assert.equal(result.alerts.length, 2);
  assert.match(result.alerts[0], /daily-results が 50\.0 時間/);
});

test("BUY の通知タイミング: 締切前の通知・締切後の直前情報・情報なし・通知なしを分ける", () => {
  const base = { date: "2026-10-06", closeAt: "13:46" };
  assert.equal(classifyBuyTiming({ ...base, sentAt: "2026-10-06 04:40:00", infoAt: "2026-10-06T04:20:00.000Z" }), "notified");
  assert.equal(classifyBuyTiming({ ...base, sentAt: "2026-10-07 12:33:29", infoAt: "2026-10-06T05:02:03.774Z" }), "info-after-close");
  assert.equal(classifyBuyTiming({ ...base, sentAt: null, infoAt: null }), "no-info");
  assert.equal(classifyBuyTiming({ ...base, sentAt: null, infoAt: "2026-10-06T04:20:00.000Z" }), "not-notified");
  assert.equal(parseDbTimestamp("2026-10-06 04:40:00"), Date.parse("2026-10-06T04:40:00Z"));
  assert.equal(parseDbTimestamp("bad"), null);
});

test("日次まとめは、締切前に通知できた BUY の成績を別の行で出す", () => {
  const all = summarizeBuyLedger([{ date: "2026-10-01", hit: true, payoutYen: 4000 }, { date: "2026-10-02", hit: false, payoutYen: null }]);
  const notified = summarizeBuyLedger([{ date: "2026-10-02", hit: false, payoutYen: null }]);
  const lines = formatLedgerAndAccuracyLines(all, null, new Date(), notified);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /うち締切前に通知できた BUY: 1 件・的中 0 .*残り 1 件は締切後に BUY 判定/);
});
