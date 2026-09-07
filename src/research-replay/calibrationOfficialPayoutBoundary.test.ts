import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-calibration.ts", "utf8");

test("calibration report stays canonical read-only and query-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /CALIBRATION_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("calibration ROI uses complete official settlements while current odds remain a quote feature", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const reportIndex = source.indexOf("const rows = [");

  assert.ok(guardIndex >= 0 && guardIndex < reportIndex, "official settlement preflight must run before calibration ROI");
  assert.match(source, /CALIBRATION_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /AVG\(current_odds\) AS avg_current_odds/);
  assert.doesNotMatch(source, /CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds/);
});
