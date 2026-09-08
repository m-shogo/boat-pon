import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-hypothesis-sets-raw.ts", "utf8");

test("ROI hypothesis entrypoint verifies the database and settlement integrity before raw analysis", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(entrypoint, /PRAGMA query_only = ON/);
  assert.match(entrypoint, /FROM race_payouts rp/);
  assert.match(entrypoint, /rp\.bet_type = \?/);
  assert.match(entrypoint, /rp\.payout_yen > 0/);
  assert.match(entrypoint, /rp\.combination = h\.selection/);
  assert.match(entrypoint, /rp\.returned = 0/);
  assert.doesNotMatch(entrypoint, /rp\.bet_type = h\.bet_type/);
  const integrity = entrypoint.indexOf("WITH relevant_hits AS");
  const rawLaunch = entrypoint.indexOf("analyze-roi-hypothesis-sets-raw.ts");
  assert.ok(integrity >= 0);
  assert.ok(rawLaunch > integrity);
});

test("ROI hypothesis raw core fails closed on return-state and exact winning-key settlement drift before scenario analysis", () => {
  assert.match(raw, /assertOfficialSettlementIntegrity\(\)/);
  assert.match(raw, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(raw, /WITH relevant_hits AS/);
  assert.match(raw, /SELECT COUNT\(\*\)[\s\S]*FROM race_payouts rp[\s\S]*rp\.combination = h\.selection/);
  assert.match(raw, /rp\.returned = 0/);
  assert.match(raw, /rp\.payout_yen > 0/);
  assert.match(raw, /ROI_HYPOTHESIS_INVALID_RETURN_STATE/);
  assert.match(raw, /ROI_HYPOTHESIS_SETTLEMENT_INTEGRITY/);
  const directGate = raw.indexOf("assertOfficialSettlementIntegrity()");
  const coverageGate = raw.indexOf("const payoutCompleteness = verifyOfficialPayoutCompleteness()");
  const loadRows = raw.indexOf("const rows = loadRows().sort");
  assert.ok(directGate >= 0);
  assert.ok(coverageGate > directGate);
  assert.ok(loadRows > coverageGate);
});

test("ROI hypothesis raw core retains official payout completeness and scenario-ranking fail closed behavior", () => {
  assert.match(raw, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(raw, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(raw, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(raw, /if \(!payoutCompleteness\.complete\)/);
  assert.match(raw, /process\.exitCode = 2/);
  assert.match(raw, /FROM race_payouts rp/);
  assert.match(raw, /rp\.payout_yen/);
  assert.match(raw, /rp\.bet_type = \?/);
  assert.match(raw, /dh\.bet_type = \?/);
  assert.match(raw, /\.get\(PAYOUT_BET_TYPE, DECISION_BET_TYPE\)/);
  assert.match(raw, /\.all\(PAYOUT_BET_TYPE, DECISION_BET_TYPE\)/);
  assert.match(raw, /rp\.combination = dh\.selection/);
  assert.match(raw, /dh\.returned = 0/);
  assert.match(raw, /rp\.returned = 0/);
  assert.match(raw, /rp\.payout_yen > 0/);
  assert.match(raw, /metricBasis: "official_payout_yen"/);
  assert.doesNotMatch(raw, /rp\.bet_type = dh\.bet_type/);
  assert.doesNotMatch(raw, /LIMIT 1/);
  const gate = raw.indexOf("if (!payoutCompleteness.complete)");
  const loadRows = raw.indexOf("const rows = loadRows().sort");
  const scenarios = raw.indexOf("const scenarios = buildScenarios()");
  assert.ok(gate >= 0);
  assert.ok(loadRows > gate);
  assert.ok(scenarios > loadRows);
});

test("ROI hypothesis metrics sum realized payouts and remove realized max hit", () => {
  assert.doesNotMatch(raw, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(raw, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(raw, /returnYen - maxHitPayoutYen/);
  assert.match(raw, /ROI_HYPOTHESIS_MATCHING_PAYOUT_MISSING/);
});
