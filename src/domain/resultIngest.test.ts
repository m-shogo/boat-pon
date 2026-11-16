import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isLzhArchive, isResultDayComplete, parseMaxDownloads, shouldSkipResultDay } from "./resultIngest";

test("番組の数だけ結果がそろった日だけを、取り込み済みとして飛ばす", () => {
  assert.equal(isResultDayComplete({ results: 156, programs: 156 }), true);
  assert.equal(isResultDayComplete({ results: 95, programs: 156 }), false); // 取り込みが途中で止まった日（2026-05 に実例）
  assert.equal(isResultDayComplete({ results: 0, programs: 156 }), false);
  assert.equal(isResultDayComplete({ results: 132, programs: 0 }), true); // 番組表が欠けた期間
  assert.equal(isResultDayComplete({ results: 0, programs: 0 }), false);
});

test("LZH の形でない応答（エラーページ・途中で切れたもの）を弾く", () => {
  const header = Buffer.from([0x2c, 0x00, ...Buffer.from("-lh5-", "latin1"), ...new Array(30).fill(0)]);
  assert.equal(isLzhArchive(header), true);
  assert.equal(isLzhArchive(Buffer.from("<!DOCTYPE html><html><body>Not Found</body></html>", "latin1")), false);
  assert.equal(isLzhArchive(header.subarray(0, 10)), false);
});

test("穴埋め: 手元に K ファイルが無い日は、結果がそろっていても取りに行く", () => {
  const base = { skipExisting: true, resultsComplete: true, onlyMissingArchive: true, archiveCached: false };
  // 2026-06-02〜07-03: 結果は入っているが K ファイルが無く、全券種の払戻が空だった
  assert.equal(shouldSkipResultDay(base), false);
  assert.equal(shouldSkipResultDay({ ...base, archiveCached: true }), true);
  // 結果がそろっていなくても、ファイルが手元にあれば穴埋めでは触らない（ふだんの取り込みが読み直す）
  assert.equal(shouldSkipResultDay({ ...base, resultsComplete: false, archiveCached: true }), true);
});

test("ふだんの取り込み: 結果がそろっている日だけを飛ばす（これまでどおり）", () => {
  const base = { skipExisting: true, resultsComplete: true, onlyMissingArchive: false, archiveCached: false };
  assert.equal(shouldSkipResultDay(base), true);
  assert.equal(shouldSkipResultDay({ ...base, resultsComplete: false }), false);
  assert.equal(shouldSkipResultDay({ ...base, skipExisting: false }), false);
  assert.equal(shouldSkipResultDay({ ...base, archiveCached: true }), true);
});

test("ダウンロードの上限: 正の整数だけを受け付け、それ以外は上限なし", () => {
  assert.equal(parseMaxDownloads("200"), 200);
  assert.equal(parseMaxDownloads(" 5 "), 5);
  for (const bad of [undefined, "", "0", "-3", "1.5", "abc"]) assert.equal(parseMaxDownloads(bad), Number.POSITIVE_INFINITY);
});
