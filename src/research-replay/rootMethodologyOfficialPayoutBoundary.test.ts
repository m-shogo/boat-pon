import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("root methodology calibration uses canonical official settlements", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertCalibrationSettlementIntegrity\(\)/);
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.bet_type='trifecta'/);
  assert.match(source, /rp\.combination=dh\.selection/);
  assert.match(source, /WHERE total_rows != 1 OR valid_rows != 1/);
  assert.match(source, /ROOT_METHODOLOGY_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /dh\.returned=0/);
  assert.match(source, /payoutBasis: "race_payouts\.payout_yen \/ 100円 \(official trifecta settlement\)"/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN result=selection AND returned=0 THEN payout_yen ELSE 0 END\)/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
