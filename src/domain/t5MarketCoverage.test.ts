import assert from "node:assert/strict";
import test from "node:test";
import { evaluateT5MarketCoverage } from "./t5MarketCoverage";

test("coverage 80%以上かつsettled 1000件以上で通過する", () => {
  assert.deepEqual(evaluateT5MarketCoverage({
    programs: 1_200,
    fullMarketRaces: 1_000,
    settledFullMarketRaces: 1_000,
  }), { passed: true, coverage: 5 / 6, reasons: [] });
});

test("部分的なT-5保存を完全市場として扱わない", () => {
  const result = evaluateT5MarketCoverage({
    programs: 10_000,
    fullMarketRaces: 400,
    settledFullMarketRaces: 300,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, [
    "T-5全120通りcoverageが4.0%",
    "結果確定済みT-5完全市場が300/1000",
  ]);
});
