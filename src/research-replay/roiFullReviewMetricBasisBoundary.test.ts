import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewSource = readFileSync("scripts/run-roi-full-review.ts", "utf8");
const allFeatureSource = readFileSync("scripts/search-roi-all-features-lite.ts", "utf8");

test("ROI full review fails closed while all-feature search uses quote-based returns", () => {
  assert.match(allFeatureSource, /hitOdds\.reduce\(\(s, o\) => s \+ o \* STAKE_YEN, 0\)/);
  assert.match(reviewSource, /assertRealizedPayoutMetricBasis\(\);/);
  assert.match(reviewSource, /ROI_FULL_REVIEW_METRIC_BASIS_UNSAFE/);
  assert.match(reviewSource, /source\.includes\("race_payouts"\)/);
  assert.match(reviewSource, /source\.includes\("payout_yen"\)/);
});

test("ROI full review checks metric basis before running all-feature search or producing GO/PAPER", () => {
  const gate = reviewSource.indexOf("assertRealizedPayoutMetricBasis();");
  const execute = reviewSource.indexOf('"scripts/search-roi-all-features-lite.ts"');
  const finalDecision = reviewSource.indexOf("const finalDecision = decide(");
  assert.ok(gate >= 0);
  assert.ok(execute > gate);
  assert.ok(finalDecision > gate);
});
