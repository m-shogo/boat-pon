import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/search-roi-all-features-lite.ts", "utf8");

test("all-feature ROI search uses verified read-only official payouts", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen/);
  assert.match(source, /rp\.bet_type = dh\.bet_type/);
  assert.match(source, /rp\.combination = dh\.selection/);
  assert.match(source, /dh\.returned = 0/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /metricBasis: "official_payout_yen"/);
});

test("all-feature ROI search fails closed before rule verdicts on incomplete settlement coverage", () => {
  assert.match(source, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(source, /if \(!payoutCompleteness\.complete\)/);
  assert.match(source, /process\.exitCode = 2/);
  const coverageGate = source.indexOf("if (!payoutCompleteness.complete)");
  const loadRows = source.indexOf("const rows = loadRows().sort");
  const buildRules = source.indexOf("const rules = buildRules(rows)");
  assert.ok(coverageGate >= 0);
  assert.ok(loadRows > coverageGate);
  assert.ok(buildRules > loadRows);
});

test("all-feature ROI metrics sum realized payouts and robustness removes realized max hit", () => {
  assert.doesNotMatch(source, /hitOdds\.reduce\(\(s, o\) => s \+ o \* STAKE_YEN, 0\)/);
  assert.match(source, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(source, /returnYen - maxHitPayoutYen/);
  assert.match(source, /ROI_ALL_FEATURE_MATCHING_PAYOUT_MISSING/);
});

test("all-feature rule mining excludes post-outcome target leakage", () => {
  for (const key of ["result", "payout_yen", "hit_payout_yen", "popularity", "returned"]) {
    assert.match(source, new RegExp(`\\"${key}\\"`));
  }
  assert.match(source, /POST_OUTCOME_FEATURE_KEYS\.has\(key\)/);
  assert.doesNotMatch(source, /f\.derived_result_match\s*=/);
  assert.match(source, /postOutcomeFeaturesExcluded: true/);
});
