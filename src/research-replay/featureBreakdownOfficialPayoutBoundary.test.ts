import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-feature-breakdown.ts", "utf8");

test("feature breakdown verifies canonical database identity and stays query-only without disclosing the configured path", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /FEATURE_BREAKDOWN_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("feature breakdown rejects unsupported bet types across the full report population before feature-band ROI", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /FEATURE_BREAKDOWN_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mappingIndex = source.indexOf("assertSupportedBetTypeMapping();");
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const reportIndex = source.indexOf("const rows = FACTORS.flatMap");
  assert.ok(mappingIndex >= 0 && guardIndex > mappingIndex && reportIndex > guardIndex);
});

test("feature breakdown rejects blank settled results and validates every remaining denominator against canonical settlement before ROI", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const reportIndex = source.indexOf("const rows = FACTORS.flatMap");

  assert.ok(guardIndex >= 0 && guardIndex < reportIndex, "official settlement preflight must run before feature ROI reporting");
  assert.match(source, /FEATURE_BREAKDOWN_BLANK_SETTLED_RESULT_UNSUPPORTED/);
  assert.match(source, /FEATURE_BREAKDOWN_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /WITH blank_settled AS/);
  assert.match(source, /AND result IS NOT NULL/);
  assert.match(source, /AND TRIM\(result\) = ''/);
  assert.match(source, /relevant_settled AS/);
  assert.match(source, /AND TRIM\(result\) != ''/);
  assert.match(source, /AND returned = 0/);
  assert.doesNotMatch(source, /relevant_hits AS/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*result/);
  assert.match(source, /s\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.bet_type = s\.payout_bet_type/);
  assert.match(source, /rp\.combination = s\.result/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /SUM\(CASE WHEN result IS NOT NULL AND TRIM\(result\) != '' AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(source, /SUM\(CASE WHEN result IS NOT NULL AND TRIM\(result\) != '' AND selection = result AND returned = 0 THEN 1 ELSE 0 END\) AS hits/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END\)/);
});
