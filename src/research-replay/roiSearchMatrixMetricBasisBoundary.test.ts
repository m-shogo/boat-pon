import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const matrixSource = readFileSync("scripts/run-roi-search-matrix.ts", "utf-8");
const searchSource = readFileSync("scripts/search-roi-patterns.ts", "utf-8");

test("ROI search matrix accepts only realized-payout pattern search output", () => {
  assert.doesNotMatch(searchSource, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(searchSource, /metricBasis: "official_payout_yen"/);
  assert.match(searchSource, /FROM race_payouts rp/);
  assert.match(searchSource, /rp\.payout_yen/);
  assert.match(matrixSource, /assertRealizedPayoutMetricBasis\(\);/);
  assert.match(matrixSource, /ROI_SEARCH_MATRIX_METRIC_BASIS_UNSAFE/);
  assert.match(matrixSource, /source\.includes\("race_payouts"\)/);
  assert.match(matrixSource, /source\.includes\("payout_yen"\)/);
});

test("ROI matrix does not run pattern search before the metric-basis gate", () => {
  const gate = matrixSource.indexOf("assertRealizedPayoutMetricBasis();");
  const execute = matrixSource.indexOf('execFileSync("pnpm", ["search:roi-patterns"]');
  assert.ok(gate >= 0);
  assert.ok(execute > gate);
});
