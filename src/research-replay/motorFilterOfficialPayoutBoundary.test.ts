import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-motor-filter-consistency.ts", "utf8");

test("motor filter research verifies canonical DB identity and remains read-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "MOTOR_FILTER_PRIMARY_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("motor filter ROI uses positive official market settlement, not current odds returns", () => {
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /settled\.payout_yen > 0/);
  assert.match(source, /MOTOR_FILTER_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /r\.selection === r\.result \? r\.payoutYen : 0/);
  assert.doesNotMatch(source, /sum \+ r\.odds \* 100/);
  assert.match(source, /roiBasis: "official-race-payouts"/);
});

test("motor filter fails closed on ambiguous exact winning settlement keys before ROI rows load", () => {
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.bet_type, dh\.selection/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.returned = 0[\s\S]*rp\.payout_yen > 0/);
  assert.match(source, /MOTOR_FILTER_PAYOUT_SETTLEMENT_AMBIGUOUS/);
  const integrity = source.indexOf("assertWinningSettlementIntegrity();");
  const rows = source.indexOf("const rows = loadRows();");
  assert.ok(integrity >= 0 && rows > integrity);
});

test("motor filter settlement integrity is combination-scoped and preserves legitimate multi-line markets", () => {
  assert.match(source, /rp\.race_id = h\.race_id/);
  assert.match(source, /rp\.bet_type = h\.bet_type/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.doesNotMatch(source, /GROUP BY\s+rp\.race_id\s*$/m);
});
