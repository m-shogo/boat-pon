import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-venue-monthly.ts", "utf-8");

test("venue monthly ROI uses an exact positive non-refund official settlement rather than current_odds returns", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});

test("venue monthly fails closed on ambiguous winning settlement keys before grouped ROI generation", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
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
