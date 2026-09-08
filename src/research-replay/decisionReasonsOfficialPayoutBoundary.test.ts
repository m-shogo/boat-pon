import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-decision-reasons.ts", "utf8");

test("decision reasons report uses verified read-only canonical DB", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("decision reasons ROI maps decision bet types to official payout namespaces", () => {
  assert.match(source, /function payoutBetTypeSql/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /rp\.race_id = dh\.race_id/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("dh\.bet_type"\)\}/);
  assert.match(source, /rp\.combination = dh\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /metricBasis: "official_payout_yen"/);
  assert.match(source, /AVG\(current_odds\)/);
  assert.doesNotMatch(source, /rp\.bet_type = dh\.bet_type/);
  assert.doesNotMatch(source, /selection = result AND returned = 0 THEN current_odds/);
});

test("decision reasons settlement gate follows the exact filtered reason cohort", () => {
  assert.match(source, /function reportScope\(\): QueryScope/);
  assert.match(source, /JOIN json_each\(CASE[\s\S]*json_valid\(dh\.decision_reasons\)/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*dh\.selection/);
  assert.match(source, /dh\.result IS NOT NULL/);
  assert.match(source, /dh\.returned = 0/);
  assert.match(source, /dh\.selection = dh\.result/);
  assert.match(source, /h\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.bet_type = h\.payout_bet_type/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*FROM race_payouts rp[\s\S]*rp\.combination = h\.selection[\s\S]*\) != 1/);
  assert.match(source, /DECISION_REASONS_REPORT_SETTLEMENT_INTEGRITY_INVALID/);
  assert.doesNotMatch(source, /rp\.bet_type = h\.bet_type/);
});

test("decision reasons validates settlements before producing grouped ROI", () => {
  const gate = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(gate >= 0 && query > gate);
});
