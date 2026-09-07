import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("rule candidates report verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/report-rule-candidates.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /RULE_CANDIDATES_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("rule candidates report fails closed when a winning ticket lacks one valid official settlement", () => {
  const source = readFileSync("scripts/report-rule-candidates.ts", "utf8");
  const guardIndex = source.indexOf("assertOfficialSettlementIntegrity();");
  const queryIndex = source.indexOf("const eligibleRows = [");

  assert.ok(guardIndex >= 0 && guardIndex < queryIndex, "settlement preflight must run before ROI suggestions");
  assert.match(source, /RULE_CANDIDATES_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /\) != 1/);
});
