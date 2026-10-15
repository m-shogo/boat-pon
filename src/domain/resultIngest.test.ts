import assert from "node:assert/strict";
import test from "node:test";
import { isResultDayComplete } from "./resultIngest";

test("番組の数だけ結果がそろった日だけを、取り込み済みとして飛ばす", () => {
  assert.equal(isResultDayComplete({ results: 156, programs: 156 }), true);
  assert.equal(isResultDayComplete({ results: 95, programs: 156 }), false); // 取り込みが途中で止まった日（2026-05 に実例）
  assert.equal(isResultDayComplete({ results: 0, programs: 156 }), false);
  assert.equal(isResultDayComplete({ results: 132, programs: 0 }), true); // 番組表が欠けた期間
  assert.equal(isResultDayComplete({ results: 0, programs: 0 }), false);
});
