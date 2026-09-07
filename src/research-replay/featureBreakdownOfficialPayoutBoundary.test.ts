import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-feature-breakdown.ts", "utf8");

test("feature breakdown verifies canonical database identity and stays query-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /FEATURE_BREAKDOWN_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("feature breakdown uses complete official settlement before feature-band ROI", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const reportIndex = source.indexOf("const rows = FACTORS.flatMap");

  assert.ok(guardIndex >= 0 && guardIndex < reportIndex, "official settlement preflight must run before feature ROI reporting");
  assert.match(source, /FEATURE_BREAKDOWN_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END\)/);
});
