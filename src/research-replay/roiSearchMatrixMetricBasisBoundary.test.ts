import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const matrixSource = readFileSync("scripts/run-roi-search-matrix.ts", "utf-8");
const searchEntrypoint = readFileSync("scripts/search-roi-patterns.ts", "utf-8");
const searchRaw = readFileSync("scripts/search-roi-patterns-raw.ts", "utf-8");

test("ROI search matrix accepts only realized-payout pattern search output", () => {
  assert.doesNotMatch(searchRaw, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(searchRaw, /metricBasis: "official_payout_yen"/);
  assert.match(searchRaw, /FROM race_payouts rp/);
  assert.match(searchRaw, /rp\.payout_yen/);
  assert.match(searchEntrypoint, /scripts\/search-roi-patterns-raw\.ts/);
  assert.match(searchEntrypoint, /FROM race_payouts rp/);
  assert.match(searchEntrypoint, /rp\.payout_yen > 0/);
  assert.match(matrixSource, /const SEARCH_METRIC_SOURCE = "scripts\/search-roi-patterns-raw\.ts"/);
  assert.match(matrixSource, /readFileSync\(SEARCH_METRIC_SOURCE, "utf8"\)/);
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
