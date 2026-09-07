import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/search-roi-patterns.ts", "utf8");
const raw = readFileSync("scripts/search-roi-patterns-raw.ts", "utf8");

test("ROI pattern entrypoint verifies exact winning settlement integrity before raw analysis", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(entrypoint, /PRAGMA query_only = ON/);
  assert.match(entrypoint, /SELECT DISTINCT dh\.race_id, dh\.bet_type, dh\.selection/);
  assert.match(entrypoint, /rp\.combination = h\.selection/);
  assert.match(entrypoint, /rp\.returned = 0/);
  assert.match(entrypoint, /rp\.payout_yen > 0/);
  assert.match(entrypoint, /\) != 1/);
  const integrity = entrypoint.indexOf("WITH relevant_hits AS");
  const rawLaunch = entrypoint.indexOf("scripts/search-roi-patterns-raw.ts");
  assert.ok(integrity >= 0);
  assert.ok(rawLaunch > integrity);
});

test("ROI pattern raw core retains official payout completeness before verdict generation", () => {
  assert.match(raw, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(raw, /if \(!payoutCompleteness\.complete\)/);
  assert.match(raw, /process\.exitCode = 2/);
  assert.match(raw, /FROM race_payouts rp/);
  assert.match(raw, /rp\.payout_yen/);
  assert.match(raw, /rp\.bet_type = dh\.bet_type/);
  assert.match(raw, /rp\.combination = dh\.selection/);
  assert.match(raw, /dh\.returned = 0/);
  assert.match(raw, /rp\.returned = 0/);
  assert.match(raw, /metricBasis: "official_payout_yen"/);
  const coverageGate = raw.indexOf("if (!payoutCompleteness.complete)");
  const buildRules = raw.indexOf("const singleRules = buildRules(rows);");
  assert.ok(coverageGate >= 0);
  assert.ok(buildRules > coverageGate);
});

test("ROI pattern metric sums realized payout yen instead of quote odds", () => {
  assert.doesNotMatch(raw, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(raw, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(raw, /returnYen - maxHitPayoutYen/);
  assert.match(raw, /ROI_PATTERN_MATCHING_PAYOUT_MISSING/);
});
