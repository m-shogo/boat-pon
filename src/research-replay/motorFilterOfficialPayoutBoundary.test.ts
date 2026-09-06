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
