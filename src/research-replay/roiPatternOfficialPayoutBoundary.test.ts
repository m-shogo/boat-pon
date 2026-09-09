import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/search-roi-patterns.ts", "utf8");
const raw = readFileSync("scripts/search-roi-patterns-raw.ts", "utf8");
const internal = readFileSync("scripts/search-roi-patterns-internal.ts", "utf8");

test("ROI pattern entrypoint rejects unknown or returned historical BUY rows before settlement and guarded analysis", () => {
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(entrypoint, /unknown or returned settlement state/);
  const returnGate = entrypoint.indexOf("const invalidReturn = db.prepare");
  const integrity = entrypoint.indexOf("WITH relevant_settled AS");
  const rawLaunch = entrypoint.indexOf('await import("./search-roi-patterns-raw")');
  assert.ok(returnGate >= 0);
  assert.ok(integrity > returnGate);
  assert.ok(rawLaunch > integrity);
});

test("ROI pattern entrypoint validates every settled denominator against the canonical trifecta winning result", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(entrypoint, /PRAGMA query_only = ON/);
  assert.match(entrypoint, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(entrypoint, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(entrypoint, /WITH relevant_settled AS/);
  assert.match(entrypoint, /SELECT DISTINCT dh\.race_id, dh\.result/);
  assert.doesNotMatch(entrypoint, /WITH relevant_hits AS/);
  assert.match(entrypoint, /dh\.bet_type = \?/);
  assert.match(entrypoint, /rp\.bet_type = \?/);
  assert.match(entrypoint, /\.get\(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE\)/);
  assert.match(entrypoint, /rp\.combination = s\.result/);
  assert.match(entrypoint, /rp\.returned = 0/);
  assert.match(entrypoint, /rp\.payout_yen IS NOT NULL/);
  assert.match(entrypoint, /rp\.payout_yen > 0/);
  assert.doesNotMatch(entrypoint, /rp\.bet_type = h\.bet_type/);
  assert.match(entrypoint, /\) != 1/);
  const integrity = entrypoint.indexOf("WITH relevant_settled AS");
  const rawLaunch = entrypoint.indexOf('await import("./search-roi-patterns-raw")');
  assert.ok(integrity >= 0);
  assert.ok(rawLaunch > integrity);
});

test("ROI pattern raw compatibility module cannot be executed directly", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /ROI_PATTERN_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/search-roi-patterns-internal"\)/);
  assert.doesNotMatch(raw, /FROM race_payouts rp/);
});

test("ROI pattern internal core retains official payout completeness before verdict generation", () => {
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
  const coverageGate = internal.indexOf("if (!payoutCompleteness.complete)");
  const buildRules = internal.indexOf("const singleRules = buildRules(rows);");
  assert.ok(coverageGate >= 0);
  assert.ok(buildRules > coverageGate);
});

test("ROI pattern metric sums realized payout yen instead of quote odds", () => {
  assert.doesNotMatch(internal, /hitOdds\.reduce\(\(sum, odds\) => sum \+ odds \* STAKE_YEN, 0\)/);
  assert.match(internal, /rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(internal, /returnYen - maxHitPayoutYen/);
  assert.match(internal, /ROI_PATTERN_MATCHING_PAYOUT_MISSING/);
});
