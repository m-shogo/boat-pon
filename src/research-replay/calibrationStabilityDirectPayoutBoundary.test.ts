import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("calibration stability direct analyzer fails closed on non-canonical or ambiguous official settlements", () => {
  const source = readFileSync("scripts/analyze-calibration-stability.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.bet_type='trifecta'/);
  assert.match(source, /rp\.combination=decision_history\.selection/);
  assert.match(source, /WHERE total_rows != 1 OR valid_rows != 1/);
  assert.match(source, /CALIBRATION_STABILITY_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /assertPayoutCompleteness\(train, "train"\)/);
  assert.match(source, /assertPayoutCompleteness\(forward, "forward"\)/);
  assert.match(source, /CALIBRATION_STABILITY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /hits\.map\(requiredPayout\)/);
  assert.match(source, /requiredPayout\(b\.r\) > requiredPayout\(a\.r\)/);
  assert.match(source, /payoutBasis:"race_payouts\.payout_yen \/ 100円 \(official trifecta settlement\)"/);
  assert.doesNotMatch(source, /SELECT id,date,venue,selection,estimated_hit_rate,current_odds,result,payout_yen\s+FROM decision_history/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("calibration stability payout audit uses the same official settlement authority", () => {
  const source = readFileSync("scripts/audit-calibration-stability-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /WHERE total_rows != 1 OR valid_rows != 1/);
  assert.match(source, /CALIBRATION_STABILITY_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /payoutBasis: "official-race_payouts"/);
});
