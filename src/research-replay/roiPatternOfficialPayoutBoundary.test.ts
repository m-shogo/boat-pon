import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/search-roi-patterns.ts", "utf8");

test("ROI pattern search uses official payouts and excludes returned rows", () => {
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

test("ROI pattern search fails closed before verdict generation on incomplete settlement coverage", () => {
  assert.match(source, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(source, /if \(!payoutCompleteness\.complete\)/);
  assert.match(source, /process\.exitCode = 2/);
  const coverageGate = source.indexOf("if (!payoutCompleteness.complete)");
  const buildRules = source.indexOf("const singleRules = buildRules(rows);");
  assert.ok(coverageGate >= 0);
  assert.ok(buildRules > coverageGate);
});

test("ROI metric sums realized payout yen instead of quote odds", () => {
  assert.doesNotMatch(source, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(source, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(source, /returnYen - maxHitPayoutYen/);
  assert.match(source, /ROI_PATTERN_MATCHING_PAYOUT_MISSING/);
});
