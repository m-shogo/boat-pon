import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isLzhArchive, isResultDayComplete } from "./resultIngest";

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
