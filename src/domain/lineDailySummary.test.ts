import assert from "node:assert/strict";
import test from "node:test";
import { formatNoBuyReasonSummary, summarizeNoBuyReasons } from "./lineDailySummary";

test("見送り理由をカテゴリ化して件数順にまとめる", () => {
  const summary = summarizeNoBuyReasons([
    JSON.stringify(["シャープマネー逆行(97%下落)", "1着候補級別が対象外(A1)"]),
    JSON.stringify(["シャープマネー逆行(99%下落)", "除外会場(三国)"]),
    JSON.stringify(["常滑はS帯のみBUY候補(現在B帯: sample=10)"]),
  ]);
  assert.deepEqual(summary, [
    { reason: "シャープマネー逆行", count: 2 },
    { reason: "1着候補級別が対象外", count: 1 },
    { reason: "会場別S帯条件未達", count: 1 },
    { reason: "除外会場", count: 1 },
  ]);
});

test("同一レース内の同カテゴリは重複加算しない", () => {
  const summary = summarizeNoBuyReasons([
    JSON.stringify(["除外会場(三国)", "除外会場(戸田)"]),
    "invalid-json",
    null,
  ]);
  assert.deepEqual(summary, [{ reason: "除外会場", count: 1 }]);
});

test("LINE表示用にランキングを整形する", () => {
  assert.equal(
    formatNoBuyReasonSummary([{ reason: "オッズ未取得", count: 3 }]),
    "見送り理由TOP5（1レース複数理由あり）:\n・オッズ未取得: 3件",
  );
  assert.equal(formatNoBuyReasonSummary([]), "見送り理由: 記録なし");
});
