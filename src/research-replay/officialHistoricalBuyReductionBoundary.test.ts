import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-official-historical-buy-reduction.ts", "utf8");

test("official historical BUY reduction report uses verified read-only canonical DB", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(source, /dbPath: DB_PATH/);
  assert.doesNotMatch(source, /console\.log\(`DB: \$\{DB_PATH\}`\)/);
});

test("official historical BUY reduction rejects unknown or returned target rows before settlement and verdict analysis", () => {
  assert.match(source, /function assertReturnStateIntegrity\(\): void/);
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /OFFICIAL_HISTORICAL_BUY_REDUCTION_RETURN_STATE_INVALID/);
  const returnGate = source.indexOf("assertReturnStateIntegrity();");
  const settlementGate = source.indexOf("assertOfficialSettlementIntegrity();");
  const evaluate = source.indexOf("buildConditions().map(evaluateCondition)");
  assert.ok(returnGate >= 0);
  assert.ok(settlementGate > returnGate);
  assert.ok(evaluate > settlementGate);
});

test("official historical BUY reduction cohort remains fixed to non-returned settled decisions", () => {
  const matches = source.match(/dh\.returned = 0/g) ?? [];
  assert.ok(matches.length >= 2, "returned=0 must guard both settlement preflight and analysis cohort");
  assert.match(source, /run_kind = 'historical-backfill'/);
  assert.match(source, /decision = 'BUY'/);
  assert.match(source, /dh\.result IS NOT NULL/);
  assert.match(source, /dh\.result != ''/);
});

test("official historical BUY reduction maps decision 3連単 rows to canonical trifecta settlements", () => {
  assert.match(source, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(source, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(source, /dh\.bet_type = \?/);
  assert.match(source, /rp\.bet_type = \?/);
  assert.match(source, /\.get\(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE\)/);
  assert.match(source, /rp\.bet_type = '\$\{PAYOUT_BET_TYPE\}'/);
  assert.match(source, /dh\.bet_type = '\$\{DECISION_BET_TYPE\}'/);
  assert.doesNotMatch(source, /rp\.bet_type = h\.bet_type/);
  assert.doesNotMatch(source, /rp\.bet_type = dh\.bet_type/);
});

test("official historical BUY reduction ROI uses exact official settlements", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.race_id = dh\.race_id/);
  assert.match(source, /rp\.bet_type = '\$\{PAYOUT_BET_TYPE\}'/);
  assert.match(source, /rp\.combination = dh\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /metricBasis: "official_payout_yen"/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN result = selection THEN current_odds ELSE 0 END\)/);
});

test("official historical BUY reduction validates every settled denominator against the official winning result", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(\): void/);
  assert.match(source, /WITH relevant_settled AS/);
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.result/);
  assert.doesNotMatch(source, /relevant_hits AS/);
  assert.doesNotMatch(source, /dh\.result = dh\.selection[\s\S]*\), invalid AS/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*FROM race_payouts rp[\s\S]*rp\.bet_type = \?[\s\S]*rp\.combination = s\.result[\s\S]*\) != 1/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /OFFICIAL_HISTORICAL_BUY_REDUCTION_SETTLEMENT_INTEGRITY_INVALID/);
  const gate = source.indexOf("assertOfficialSettlementIntegrity();");
  const evaluate = source.indexOf("buildConditions().map(evaluateCondition)");
  assert.ok(gate >= 0 && evaluate > gate, "settlement integrity must run before verdict-producing analysis");
});
