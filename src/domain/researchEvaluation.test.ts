import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCondition,
  buildRuleEvaluationResult,
  estimateConfidence,
  parseCondition,
  validateEvaluationMetadata,
} from "./researchEvaluation";
import { MIN_PRODUCTION_CONFIDENCE, MIN_PRODUCTION_SAMPLE_SIZE } from "./researchRuleLifecycle";
import type { DecisionHistoryRow } from "./backtest";
import type { DecisionStatus } from "./types";

const VALID_METADATA = {
  dataWindowStart: "2026-01-01",
  dataWindowEnd: "2026-06-01",
  evaluationRunAt: "2026-06-02T00:00:00+09:00",
  sampleSize: 100,
};

function row(id: number, overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id,
    raceId: "r" + id,
    date: "2026-02-01",
    venue: "蒲郡",
    raceNo: id,
    selection: "1-2-3",
    estimatedHitRate: 0.2,
    requiredOdds: 6,
    currentOdds: 10,
    ev: 1.2,
    decision: "BUY" as DecisionStatus,
    actuallyBought: false,
    stakeYen: 0,
    recommendedStakeYen: 100,
    sampleSize: 500,
    result: "2-1-3",
    payoutYen: null,
    popularity: null,
    returned: false,
    source: "test",
    fetchedAt: "2026-02-01T00:00:00+09:00",
    createdAt: "2026-02-01T00:00:00+09:00",
    ...overrides,
  };
}

test("dataWindowEnd が evaluationRunAt より未来なら警告（future leak）", () => {
  const result = validateEvaluationMetadata({ ...VALID_METADATA, dataWindowEnd: "2026-12-31" });
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((warning) => warning.includes("future leak")));
});

test("dataWindowStart > dataWindowEnd は失敗", () => {
  const result = validateEvaluationMetadata({ ...VALID_METADATA, dataWindowStart: "2026-06-01", dataWindowEnd: "2026-01-01" });
  assert.equal(result.ok, false);
});

test("sampleSize が負なら失敗", () => {
  const result = validateEvaluationMetadata({ ...VALID_METADATA, sampleSize: -1 });
  assert.equal(result.ok, false);
});

test("欠損フィールドは warnings に積まれる（throwしない）", () => {
  const result = validateEvaluationMetadata({});
  assert.equal(result.ok, false);
  assert.equal(result.warnings.length, 4);
});

test("正常metadataは通る", () => {
  const result = validateEvaluationMetadata(VALID_METADATA);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test("confidence は n=200 で production 最低値に一致する（暫定較正）", () => {
  assert.equal(estimateConfidence(MIN_PRODUCTION_SAMPLE_SIZE), MIN_PRODUCTION_CONFIDENCE);
  assert.equal(estimateConfidence(0), 0);
});

test("CLI出力（RuleEvaluationResult）が必須フィールドを持つ", () => {
  const result = buildRuleEvaluationResult({
    ruleId: "rule-x",
    rows: [
      row(1, { result: "1-2-3", currentOdds: 30 }),
      row(2),
      row(3, { result: null }),
      row(4, { date: "2027-01-01", result: "1-2-3", currentOdds: 99 }),
      row(5, { decision: "SKIP" as DecisionStatus, result: "1-2-3" }),
    ],
    dataWindowStart: "2026-01-01",
    dataWindowEnd: "2026-06-01",
    evaluationRunAt: "2026-06-02T00:00:00+09:00",
  });

  for (const field of [
    "ruleId", "metadata", "hitRate", "roi", "confidence", "maxDrawdown",
    "isForwardTested", "isProductionEligible", "reasonSummary", "warnings",
  ]) {
    assert.ok(field in result, `missing field: ${field}`);
  }
  for (const field of ["dataWindowStart", "dataWindowEnd", "evaluationRunAt", "sampleSize"]) {
    assert.ok(field in result.metadata, `missing metadata field: ${field}`);
  }

  // window内の確定BUYは2件（window外の2027年行・未確定行・SKIP行は除外される）
  assert.equal(result.metadata.sampleSize, 2);
  assert.equal(result.hitRate, 0.5);
  assert.equal(result.roi, 15); // payout_yen無し(currentOdds30)*100 / (100+100)
  assert.equal(result.isForwardTested, false);
  assert.equal(result.isProductionEligible, false);
  assert.ok(result.warnings.some((warning) => warning.includes("unsettled")));
});

test("payout_yen がある場合は payout_yen ベースのROIを使う", () => {
  const result = buildRuleEvaluationResult({
    ruleId: "rule-payout",
    rows: [row(1, { result: "1-2-3", currentOdds: 99, payoutYen: 1620 })],
    dataWindowStart: "2026-01-01",
    dataWindowEnd: "2026-06-01",
    evaluationRunAt: "2026-06-02T00:00:00+09:00",
  });

  // payout_yenは100円あたりの公式払戻。currentOdds(99)由来なら990になるはずだが、
  // payout_yen(1620)/100*stake(100)=1620が優先されることを確認する。
  assert.equal(result.roi, 16.2);
  assert.ok(result.reasonSummary.includes("payout_yen"));
  assert.ok(!result.warnings.some((warning) => warning.toLowerCase().includes("fallback")));
});

test("payout_yen が無い場合はcurrent_oddsへfallbackしwarningを出す", () => {
  const result = buildRuleEvaluationResult({
    ruleId: "rule-fallback",
    rows: [row(1, { result: "1-2-3", currentOdds: 30, payoutYen: null })],
    dataWindowStart: "2026-01-01",
    dataWindowEnd: "2026-06-01",
    evaluationRunAt: "2026-06-02T00:00:00+09:00",
  });

  assert.equal(result.roi, 30); // fallback: currentOdds(30)*stake(100) / stake(100)
  assert.ok(result.warnings.some((warning) => warning.includes("lack payout_yen")));
  assert.ok(result.reasonSummary.includes("current_odds (fallback)"));
});

test("--condition venue=xxx で対象が絞られる", () => {
  const rows = [row(1, { venue: "桐生" }), row(2, { venue: "蒲郡" })];
  const filtered = applyCondition(rows, { key: "venue", value: "桐生" });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].venue, "桐生");
  assert.deepEqual(filtered.warnings, []);
});

test("不正なcondition形式（=無し）はエラー", () => {
  assert.throws(() => parseCondition("badformat"));
});

test("未対応のcondition keyはwarningを出し絞り込みをしない", () => {
  const rows = [row(1), row(2)];
  const filtered = applyCondition(rows, { key: "unknownKey", value: "x" });
  assert.equal(filtered.rows.length, 2);
  assert.ok(filtered.warnings.some((warning) => warning.includes("unsupported condition key")));
});
