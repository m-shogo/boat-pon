import assert from "node:assert/strict";
import test from "node:test";
import { buildLineText, LINE_TEXT_MAX_LENGTH } from "./lineMessaging";
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
  assert.equal(message.title, "🎯 BUY候補 常滑 8R");
  assert.deepEqual(message.freshness, {
    observedAt: "2026-08-05 14:26:15 JST",
    closeAtJst: "2026-08-05 14:32 JST",
  });
  assert.equal(message.body, [
    "3連単 1-3-4",
    "",
    "⏰ 締切 2026-08-05 14:32 JST（確認 2026-08-05 14:26:15 JST）",
    "💴 推奨 100円",
    "📈 オッズ 6.4倍（必要 5.2倍以上）",
    "🎲 的中率 23.1%　EV 1.48",
    "",
    "✅ 理由",
    "・必要オッズを上回る",
    "・PITデータ完全",
    "",
    "🔗 公式オッズ",
    "https://www.boatrace.jp/owpc/pc/race/odds3t?rno=8&jcd=08&hd=20260805",
    "",
    "投票サイト",
    "https://ib.mbrace.or.jp/",
    "",
    "―――",
    "検証用の候補です。自動投票はしません。",
    "公式オッズと締切を確認して、自分で判断してください。",
    "（race 2026-08-05-08-08 / n=184 / data 完全 / model legacy-t5-v1 paper-live）",
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
  assert.match(message.body, /オッズ 未取得/);
  assert.match(message.body, /EV 未算出/);
  assert.match(message.body, /推奨 0円/);
  assert.match(message.body, /data 一部欠け/);
  assert.match(message.body, /⚠️ 注意\n・現在オッズ未取得\n・購入判断不可/);
  assert.doesNotMatch(message.body, /投票サイト/);
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


test("BUY LINE v2 keeps stakes, freshness and dedupe unchanged", () => {
  assert.equal(BUY_LINE_MESSAGE_SCHEMA_VERSION, "buy-line-message-v2");
  for (const stake of [0, 100, 12345]) {
    const input = { ...completeInput(), recommendedStakeYen: stake };
    const message = buildBuyLineMessage(input);
    assert.ok(message.body.includes(`💴 推奨 ${stake}円`));
    assert.equal(message.dedupeKey, `buy:${input.decisionId}`);
    assert.deepEqual(message.freshness, { observedAt: input.observedAt, closeAtJst: input.closeAtJst });
  }
});

test("BUY LINE omits empty lists and highlights incomplete data immediately before deadline", () => {
  for (const dataStatus of ["complete", "partial", "blocked"] as const) {
    const message = buildBuyLineMessage({ ...completeInput(), dataStatus, reasons: [" "], warnings: [] });
    assert.doesNotMatch(message.body, /✅ 理由|⚠️ 注意/);
    if (dataStatus === "complete") assert.doesNotMatch(message.body, /データが不完全/);
    else assert.match(message.body, /⚠️ データが不完全です\n⏰ 締切/);
    if (dataStatus === "blocked") assert.match(message.body, /data 取得不可/);
  }
});

test("BUY LINE retains many reasons and warnings within the LINE text limit", () => {
  const input = completeInput();
  input.reasons = Array.from({ length: 80 }, (_, i) => `理由${i}: 必要オッズと展示データを確認`);
  input.warnings = Array.from({ length: 80 }, (_, i) => `注意${i}: サンプルが少なめです`);
  const message = buildBuyLineMessage(input);
  const fullText = `${message.title}\n\n${message.body}`;
  assert.ok(fullText.length <= LINE_TEXT_MAX_LENGTH);
  assert.equal(buildLineText(message.title, message.body), fullText);
  for (const item of [...input.reasons, ...input.warnings]) assert.ok(message.body.includes(`・${item}\n`));
  assert.ok(message.body.endsWith("model legacy-t5-v1 paper-live）"));
});
