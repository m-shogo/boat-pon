import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-odds-band-outcomes.ts", "utf-8");

test("odds-band outcomes verifies the research DB before read-only SQLite open", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("odds-band ROI uses a mapped exact positive non-refund official settlement", () => {
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
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits = 0[\s\S]*?ELSE NULL[\s\S]*?END AS roi/);
  assert.match(source, /CASE WHEN missing_payout_hits = 0[\s\S]*?ELSE NULL[\s\S]*?END AS roiExMax/);
});

test("odds-band outcomes fails closed on unsupported or ambiguous winning settlement keys before band ROI generation", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
  assert.match(source, /h\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.bet_type = h\.payout_bet_type/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.combination = h\.selection/);
  assert.match(source, /\) != 1/);
  assert.match(source, /ODDS_BAND_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.doesNotMatch(source, /rp\.bet_type = h\.bet_type/);

  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const rows = source.indexOf("const rows = [");
  assert.ok(integrity >= 0 && rows > integrity);
});

test("odds-band missing-file failure does not disclose the configured database path", () => {
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
