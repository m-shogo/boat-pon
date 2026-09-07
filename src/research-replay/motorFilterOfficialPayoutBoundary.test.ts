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

test("motor filter excludes returned decision rows from both settlement validation and ROI population", () => {
  const occurrences = source.match(/dh\.returned = 0/g) ?? [];
  assert.ok(occurrences.length >= 2, "returned=0 must gate both relevant_hits and loadRows cohorts");
  assert.match(source, /WHERE dh\.run_kind='historical-backfill'[\s\S]*AND dh\.decision='BUY'[\s\S]*AND dh\.result IS NOT NULL[\s\S]*AND dh\.returned = 0/);
});
