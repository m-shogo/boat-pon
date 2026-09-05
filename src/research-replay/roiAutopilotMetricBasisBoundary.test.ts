import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-autopilot.ts", "utf8");

test("ROI autopilot excludes the still quote-based commit review from decision inputs", () => {
  assert.doesNotMatch(source, /\["pnpm", \["analyze:roi-commit"\]\]/);
  assert.doesNotMatch(source, /reports\/roi-commit-review\.json/);
  assert.doesNotMatch(source, /commitReview\?\.overall/);
  assert.match(source, /quoteBasedCommitReviewExcluded: true/);
});

test("ROI autopilot fails closed if an optional hypothesis report is not official-payout based", () => {
  assert.match(source, /assertOfficialPayoutHypotheses\(hypotheses\);/);
  assert.match(source, /report\.safety\?\.metricBasis !== "official_payout_yen"/);
  assert.match(source, /ROI_AUTOPILOT_HYPOTHESIS_METRIC_BASIS_UNSAFE/);
  const reportRead = source.indexOf('readOptionalJson<HypothesisReport>("reports/roi-hypothesis-sets.json")');
  const gate = source.indexOf("assertOfficialPayoutHypotheses(hypotheses);");
  const decision = source.indexOf("const decision = decide(");
  assert.ok(reportRead >= 0);
  assert.ok(gate > reportRead);
  assert.ok(decision > gate);
});

test("ROI autopilot declares official payout metric basis", () => {
  assert.match(source, /metricBasis: "official_payout_yen"/);
});
