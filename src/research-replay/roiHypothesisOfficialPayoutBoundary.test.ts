import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");

test("ROI hypothesis sets use verified read-only official payouts", () => {
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

test("ROI hypothesis sets fail closed before scenario ranking on incomplete settlements", () => {
  assert.match(source, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(source, /if \(!payoutCompleteness\.complete\)/);
  assert.match(source, /process\.exitCode = 2/);
  const gate = source.indexOf("if (!payoutCompleteness.complete)");
  const loadRows = source.indexOf("const rows = loadRows().sort");
  const scenarios = source.indexOf("const scenarios = buildScenarios()");
  assert.ok(gate >= 0);
  assert.ok(loadRows > gate);
  assert.ok(scenarios > loadRows);
});

test("ROI hypothesis metrics sum realized payouts and remove realized max hit", () => {
  assert.doesNotMatch(source, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(source, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(source, /returnYen - maxHitPayoutYen/);
  assert.match(source, /ROI_HYPOTHESIS_MATCHING_PAYOUT_MISSING/);
});
