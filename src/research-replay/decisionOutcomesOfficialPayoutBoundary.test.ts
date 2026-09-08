import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-decision-outcomes.ts", "utf8");

test("decision outcomes maps decision bet types into canonical payout namespaces", () => {
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

test("decision outcomes fails closed on unsupported mappings before settlement and report generation", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /DECISION_OUTCOMES_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mapping = source.indexOf("assertSupportedBetTypeMapping();");
  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(mapping >= 0 && integrity > mapping && query > integrity);
});

test("decision outcomes derives payout metrics only from an exact positive non-refund official settlement", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND\(total_payout_odds/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});

test("decision outcomes fails closed on ambiguous winning settlement keys before report generation", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /SELECT DISTINCT[\s\S]*race_id,[\s\S]*payout_bet_type,[\s\S]*selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.combination = h\.selection/);
  assert.match(source, /\) != 1/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /DECISION_OUTCOMES_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);

  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(integrity >= 0 && query > integrity);
});

test("decision outcomes verifies canonical DB identity and remains query-only", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
