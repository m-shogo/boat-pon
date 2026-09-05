import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewSource = readFileSync("scripts/run-roi-full-review.ts", "utf8");
const personaSource = readFileSync("scripts/roi-pro-persona-review.ts", "utf8");
const allFeatureSource = readFileSync("scripts/search-roi-all-features-lite.ts", "utf8");

test("ROI full review fails closed while all-feature search uses quote-based returns", () => {
  assert.match(allFeatureSource, /hitOdds\.reduce\(\(s, o\) => s \+ o \* STAKE_YEN, 0\)/);
  assert.match(reviewSource, /assertRealizedPayoutMetricBasis\(\);/);
  assert.match(reviewSource, /ROI_FULL_REVIEW_METRIC_BASIS_UNSAFE/);
  assert.match(reviewSource, /ROI_FULL_REVIEW_REPORT_METRIC_BASIS_UNSAFE/);
  assert.match(reviewSource, /source\.includes\("race_payouts"\)/);
  assert.match(reviewSource, /source\.includes\("payout_yen"\)/);
  assert.match(reviewSource, /metricBasis: \"official_payout_yen\"/);
});

test("ROI full review checks metric basis before running all-feature search or producing GO/PAPER", () => {
  const gate = reviewSource.indexOf("assertRealizedPayoutMetricBasis();");
  const execute = reviewSource.indexOf('"scripts/search-roi-all-features-lite.ts"');
  const reportGate = reviewSource.indexOf("assertOfficialPayoutReport(allFeature);");
  const finalDecision = reviewSource.indexOf("const finalDecision = decide(");
  assert.ok(gate >= 0);
  assert.ok(execute > gate);
  assert.ok(reportGate > gate);
  assert.ok(finalDecision > reportGate);
});

test("persona review cannot emit PAPER verdicts from quote-based or stale all-feature reports", () => {
  assert.match(personaSource, /assertRealizedPayoutMetricBasis\(\);/);
  assert.match(personaSource, /assertOfficialPayoutReport\(allFeature\);/);
  assert.match(personaSource, /ROI_PERSONA_REVIEW_METRIC_BASIS_UNSAFE/);
  assert.match(personaSource, /ROI_PERSONA_REVIEW_REPORT_METRIC_BASIS_UNSAFE/);
  const sourceGate = personaSource.indexOf("assertRealizedPayoutMetricBasis();");
  const reportGate = personaSource.indexOf("assertOfficialPayoutReport(allFeature);");
  const verdict = personaSource.indexOf("const finalDecision =");
  assert.ok(sourceGate >= 0);
  assert.ok(reportGate > sourceGate);
  assert.ok(verdict > reportGate);
});
