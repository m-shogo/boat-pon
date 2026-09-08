import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-rule-candidates.ts", "utf8");

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `expected ${name} before ${nextName}`);
  return source.slice(start, end);
}

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
  assert.match(source, /rp\.bet_type = s\.payout_bet_type/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
});

test("rule candidates report requires complete official settlements for every non-empty settled denominator row", () => {
  const guard = functionBody("assertOfficialSettlementIntegrity", "queryMetric");
  const query = functionBody("queryMetric", "addSuggestion");
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const eligibleRows = [");

  assert.ok(guardIndex >= 0 && guardIndex < queryIndex, "settlement preflight must run before ROI suggestions");
  assert.match(guard, /RULE_CANDIDATES_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(guard, /WITH relevant_settled AS/);
  assert.match(guard, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*result/);
  assert.match(guard, /result IS NOT NULL/);
  assert.match(guard, /result != ''/);
  assert.match(guard, /returned = 0/);
  assert.doesNotMatch(guard, /selection = result/);
  assert.match(guard, /s\.payout_bet_type IS NULL/);
  assert.match(guard, /rp\.combination = s\.result/);
  assert.match(guard, /rp\.returned = 0/);
  assert.match(guard, /rp\.payout_yen IS NOT NULL/);
  assert.match(guard, /rp\.payout_yen > 0/);
  assert.match(guard, /\) != 1/);

  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND selection = result AND returned = 0 THEN 1 ELSE 0 END\) AS hits/);
  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND selection = result AND returned = 0 AND payout_units IS NULL THEN 1 ELSE 0 END\) AS missing_payout_hits/);
});
