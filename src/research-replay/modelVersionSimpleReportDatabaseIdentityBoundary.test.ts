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
});

test("model version comparison fails closed before ROI when official settlement is incomplete or ambiguous", () => {
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const rows = queryRows();");

  assert.ok(guardIndex >= 0 && guardIndex < queryIndex, "official settlement preflight must run before model ROI comparison");
  assert.match(source, /MODEL_VERSION_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.doesNotMatch(source, /CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds/);
});
