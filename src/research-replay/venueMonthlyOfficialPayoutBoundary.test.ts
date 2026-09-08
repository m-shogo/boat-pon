import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-venue-monthly.ts", "utf-8");

test("venue monthly ROI uses mapped exact positive non-refund official settlements rather than current_odds returns", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});

test("venue monthly rejects unsupported bet types across the full report population before ROI", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /VENUE_MONTHLY_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mapping = source.indexOf("assertSupportedBetTypeMapping();");
  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(mapping >= 0 && integrity > mapping && query > integrity);
});

test("venue monthly fails closed on unsupported or ambiguous winning settlement keys before grouped ROI generation", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
  assert.match(source, /h\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.bet_type = h\.payout_bet_type/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.combination = h\.selection/);
  assert.match(source, /\) != 1/);
  assert.match(source, /VENUE_MONTHLY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);

  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(integrity >= 0 && query > integrity);
});

test("venue monthly ROI is unavailable when a winning settlement payout is missing", () => {
  const missingCount = source.indexOf("missing_payout_hits");
  const roiGuard = source.indexOf("CASE WHEN missing_payout_hits = 0");
  const roiOutput = source.indexOf("END AS roi,");

  assert.ok(missingCount >= 0, "missing official payout hits must be counted");
  assert.ok(roiGuard > missingCount, "ROI must be gated on complete winning-payout coverage");
  assert.ok(roiOutput > roiGuard, "ROI output must remain downstream of the completeness gate");
  assert.match(source, /ELSE NULL\s+END AS roi/);
  assert.match(source, /ELSE NULL\s+END AS roiExMax/);
});

test("venue monthly does not disclose the configured database path on missing-file failure", () => {
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
