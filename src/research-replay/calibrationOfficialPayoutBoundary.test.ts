import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-calibration.ts", "utf8");

test("calibration report stays canonical read-only and query-only without private path disclosure", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /CALIBRATION_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("calibration report maps decision bet types into canonical payout namespaces", () => {
  assert.match(source, /function payoutBetTypeSql\(column: string\)/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /rp\.bet_type = h\.payout_bet_type/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
});

test("calibration fails closed on unsupported mappings before official settlement and ROI", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /CALIBRATION_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mappingIndex = source.indexOf("assertSupportedBetTypeMapping();");
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const reportIndex = source.indexOf("const rows = [");
  assert.ok(mappingIndex >= 0 && guardIndex > mappingIndex && reportIndex > guardIndex);
});

test("calibration ROI uses complete official settlements while current odds remain a quote feature", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const reportIndex = source.indexOf("const rows = [");

  assert.ok(guardIndex >= 0 && guardIndex < reportIndex, "official settlement preflight must run before calibration ROI");
  assert.match(source, /CALIBRATION_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /SELECT DISTINCT[\s\S]*race_id,[\s\S]*payout_bet_type,[\s\S]*selection/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /AVG\(current_odds\) AS avg_current_odds/);
  assert.doesNotMatch(source, /CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds/);
});
