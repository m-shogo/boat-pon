import assert from "node:assert/strict";
import test from "node:test";
import {
  BUY_LINE_MESSAGE_SCHEMA_VERSION,
  buildBuyLineMessage,
  type BuyLineMessageInput,
} from "./buyLineMessageContract";

function completeInput(): BuyLineMessageInput {
  return {
    decisionId: "decision-20260805-08-8R",
    raceId: "2026-08-05-08-08",
    venue: "常滑",
    raceNo: 8,
    closeAtJst: "2026-08-05 14:32 JST",
    observedAt: "2026-08-05 14:26:15 JST",
    betType: "3連単",
    selection: "1-3-4",
    estimatedHitRate: 0.231,
    requiredOdds: 5.2,
    currentOdds: 6.4,
    expectedValue: 1.48,
    recommendedStakeYen: 100,
    sampleSize: 184,
    modelVersion: "legacy-t5-v1",
    runKind: "paper-live",
    reasons: ["必要オッズを上回る", "PITデータ完全"],
    warnings: [],
    dataStatus: "complete",
    officialOddsUrl: "https://www.boatrace.jp/owpc/pc/race/odds3t?rno=8&jcd=08&hd=20260805",
    voteUrl: "https://ib.mbrace.or.jp/",
  };
}

test("BUY LINE message is self-contained and versioned", () => {
  const message = buildBuyLineMessage(completeInput());

  assert.equal(message.schemaVersion, BUY_LINE_MESSAGE_SCHEMA_VERSION);
  assert.equal(message.dedupeKey, "buy:decision-20260805-08-8R");
  assert.equal(message.title, "🎯 BUY候補: 常滑 8R");
  assert.deepEqual(message.freshness, {
    observedAt: "2026-08-05 14:26:15 JST",
    closeAtJst: "2026-08-05 14:32 JST",
  });
  assert.equal(message.body, [
    "race: 2026-08-05-08-08",
    "候補: 1-3-4（3連単）",
    "締切: 2026-08-05 14:32 JST",
    "観測時刻: 2026-08-05 14:26:15 JST",
    "取得オッズ: 6.4倍",
    "必要オッズ: 5.2倍以上",
    "推定的中率: 23.1%",
    "EV: 1.48",
    "推奨stake: 100円",
    "sample: n=184",
    "data: COMPLETE",
    "model: legacy-t5-v1 / paper-live",
    "理由: 必要オッズを上回る / PITデータ完全",
    "警告: なし",
    "公式オッズ: https://www.boatrace.jp/owpc/pc/race/odds3t?rno=8&jcd=08&hd=20260805",
    "投票サイト: https://ib.mbrace.or.jp/",
    "",
    "※paper検証候補。自動投票なし。公式オッズと締切を確認して手動で判断してください。",
  ].join("\n"));
  assert.doesNotMatch(message.body, /public|cloudflare|dashboard/i);
});

test("BUY LINE message represents partial data without fabricating odds or EV", () => {
  const input = completeInput();
  input.currentOdds = null;
  input.expectedValue = null;
  input.recommendedStakeYen = 0;
  input.dataStatus = "partial";
  input.warnings = ["現在オッズ未取得", "購入判断不可"];
  input.voteUrl = null;

  const message = buildBuyLineMessage(input);
  assert.match(message.body, /取得オッズ: 未取得/);
  assert.match(message.body, /EV: 未算出/);
  assert.match(message.body, /推奨stake: 0円/);
  assert.match(message.body, /data: PARTIAL/);
  assert.match(message.body, /警告: 現在オッズ未取得 \/ 購入判断不可/);
  assert.doesNotMatch(message.body, /投票サイト:/);
});

test("BUY LINE message validates decision-critical values", () => {
  const invalidProbability = completeInput();
  invalidProbability.estimatedHitRate = 1.1;
  assert.throws(() => buildBuyLineMessage(invalidProbability), /estimatedHitRate must be between 0 and 1/);

  const invalidRace = completeInput();
  invalidRace.raceNo = 13;
  assert.throws(() => buildBuyLineMessage(invalidRace), /raceNo must be an integer from 1 to 12/);

  const invalidOdds = completeInput();
  invalidOdds.requiredOdds = 0;
  assert.throws(() => buildBuyLineMessage(invalidOdds), /requiredOdds must be greater than 0/);
});
