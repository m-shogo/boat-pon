import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-rule-candidates.ts", "utf8");

test("rule candidates report verifies primary database identity before opening read-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /RULE_CANDIDATES_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("rule candidates report maps decision bet types before payout-derived suggestions", () => {
  const mappingIndex = source.indexOf("assertSupportedBetTypeMapping();");
  const settlementIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const eligibleRows = [");

  assert.ok(mappingIndex >= 0 && settlementIndex > mappingIndex && queryIndex > settlementIndex);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /RULE_CANDIDATES_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /rp\.bet_type = h\.payout_bet_type/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
});

test("rule candidates report fails closed when a winning ticket lacks one valid official settlement", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const eligibleRows = [");

  assert.ok(guardIndex >= 0 && guardIndex < queryIndex, "settlement preflight must run before ROI suggestions");
  assert.match(source, /RULE_CANDIDATES_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*selection/);
  assert.match(source, /h\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /\) != 1/);
});
