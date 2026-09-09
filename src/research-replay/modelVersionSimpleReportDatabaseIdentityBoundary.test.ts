import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-model-version-simple.ts", "utf8");

test("model version simple report verifies primary database identity before opening read-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /MODEL_VERSION_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("model version comparison rejects unsupported bet types across the full report population before ROI", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /MODEL_VERSION_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mappingIndex = source.indexOf("assertSupportedBetTypeMapping();");
  const settlementIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const rows = queryRows();");
  assert.ok(
    mappingIndex >= 0 && settlementIndex > mappingIndex && queryIndex > settlementIndex,
    "full-population bet type mapping preflight must run before settlement integrity and aggregation",
  );
});

test("model version comparison rejects blank settled results and validates every nonblank denominator against official settlement", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const rows = queryRows();");

  assert.ok(guardIndex >= 0 && guardIndex < queryIndex, "official settlement preflight must run before model ROI comparison");
  assert.match(source, /WITH blank_settled AS/);
  assert.match(source, /TRIM\(result\) = ''/);
  assert.match(source, /MODEL_VERSION_BLANK_SETTLED_RESULT_UNSUPPORTED/);
  assert.match(source, /MODEL_VERSION_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /relevant_settled AS/);
  assert.match(source, /AND result IS NOT NULL/);
  assert.match(source, /TRIM\(result\) != ''/);
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
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.match(source, /SUM\(CASE WHEN result IS NOT NULL AND TRIM\(result\) != '' AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.doesNotMatch(source, /rp\.bet_type = h\.bet_type/);
  assert.doesNotMatch(source, /CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds/);
});
