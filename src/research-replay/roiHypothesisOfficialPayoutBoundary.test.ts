import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-hypothesis-sets-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-roi-hypothesis-sets-internal.ts", "utf8");

test("ROI hypothesis entrypoint verifies the database and every settled denominator before isolated internal analysis", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(entrypoint, /PRAGMA query_only = ON/);
  assert.match(entrypoint, /WITH relevant_settled AS/);
  assert.match(entrypoint, /SELECT DISTINCT dh\.race_id, dh\.result/);
  assert.doesNotMatch(entrypoint, /WITH relevant_hits AS/);
  assert.match(entrypoint, /FROM race_payouts rp/);
  assert.match(entrypoint, /rp\.bet_type = \?/);
  assert.match(entrypoint, /rp\.payout_yen IS NOT NULL/);
  assert.match(entrypoint, /rp\.payout_yen > 0/);
  assert.match(entrypoint, /rp\.combination = s\.result/);
  assert.match(entrypoint, /rp\.returned = 0/);
  assert.doesNotMatch(entrypoint, /rp\.bet_type = s\.bet_type/);
  const integrity = entrypoint.indexOf("WITH relevant_settled AS");
  const handoff = entrypoint.indexOf("ROI_HYPOTHESIS_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = entrypoint.indexOf("ROI_HYPOTHESIS_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalLaunch = entrypoint.indexOf("const analysis = spawnSync");
  assert.ok(integrity >= 0);
  assert.ok(handoff > integrity);
  assert.ok(launchIdentity > handoff);
  assert.ok(internalLaunch > launchIdentity);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-roi-hypothesis-sets-internal"\)/u);
  assert.doesNotMatch(entrypoint, /analyze-roi-hypothesis-sets-raw/);
});

test("ROI hypothesis raw compatibility module cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /ROI_HYPOTHESIS_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-roi-hypothesis-sets"\)/);
  assert.doesNotMatch(raw, /analyze-roi-hypothesis-sets-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
});

test("ROI hypothesis internal core fails closed on return-state and exact winning-key settlement drift before scenario analysis", () => {
  assert.match(internal, /assertOfficialSettlementIntegrity\(\)/);
  assert.match(internal, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(internal, /WITH relevant_hits AS/);
  assert.match(internal, /SELECT COUNT\(\*\)[\s\S]*FROM race_payouts rp[\s\S]*rp\.combination = h\.selection/);
  assert.match(internal, /rp\.returned = 0/);
  assert.match(internal, /rp\.payout_yen > 0/);
  assert.match(internal, /ROI_HYPOTHESIS_INVALID_RETURN_STATE/);
  assert.match(internal, /ROI_HYPOTHESIS_SETTLEMENT_INTEGRITY/);
  const directGate = internal.indexOf("assertOfficialSettlementIntegrity()");
  const coverageGate = internal.indexOf("const payoutCompleteness = verifyOfficialPayoutCompleteness()");
  const loadRows = internal.indexOf("const rows = loadRows().sort");
  assert.ok(directGate >= 0);
  assert.ok(coverageGate > directGate);
  assert.ok(loadRows > coverageGate);
});

test("ROI hypothesis internal core retains official payout completeness and scenario-ranking fail closed behavior", () => {
  assert.match(internal, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(internal, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(internal, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(internal, /if \(!payoutCompleteness\.complete\)/);
  assert.match(internal, /process\.exitCode = 2/);
  assert.match(internal, /FROM race_payouts rp/);
  assert.match(internal, /rp\.payout_yen/);
  assert.match(internal, /rp\.bet_type = \?/);
  assert.match(internal, /dh\.bet_type = \?/);
  assert.match(internal, /\.get\(PAYOUT_BET_TYPE, DECISION_BET_TYPE\)/);
  assert.match(internal, /\.all\(PAYOUT_BET_TYPE, DECISION_BET_TYPE\)/);
  assert.match(internal, /rp\.combination = dh\.selection/);
  assert.match(internal, /dh\.returned = 0/);
  assert.match(internal, /rp\.returned = 0/);
  assert.match(internal, /rp\.payout_yen > 0/);
  assert.match(internal, /metricBasis: "official_payout_yen"/);
  assert.doesNotMatch(internal, /rp\.bet_type = dh\.bet_type/);
  assert.doesNotMatch(internal, /LIMIT 1/);
  const gate = internal.indexOf("if (!payoutCompleteness.complete)");
  const loadRows = internal.indexOf("const rows = loadRows().sort");
  const scenarios = internal.indexOf("const scenarios = buildScenarios()");
  assert.ok(gate >= 0);
  assert.ok(loadRows > gate);
  assert.ok(scenarios > loadRows);
});

test("ROI hypothesis metrics sum realized payouts and remove realized max hit", () => {
  assert.doesNotMatch(internal, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(internal, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(internal, /returnYen - maxHitPayoutYen/);
  assert.match(internal, /ROI_HYPOTHESIS_MATCHING_PAYOUT_MISSING/);
});
