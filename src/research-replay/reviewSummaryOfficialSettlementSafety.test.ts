import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-review-summary-raw.ts", "utf8");

test("review summary validates mapped exact official winning settlements before building the summary", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /REVIEW_SUMMARY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
  assert.match(source, /h\.payout_bet_type IS NULL/u);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.race_id = h\.race_id[\s\S]*rp\.bet_type = h\.payout_bet_type[\s\S]*rp\.combination = h\.selection/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen IS NOT NULL/u);
  assert.match(source, /rp\.payout_yen > 0/u);

  const guard = source.indexOf("assertOfficialSettlementIntegrity();");
  const summary = source.indexOf("const summary = {");
  assert.ok(guard >= 0 && summary > guard);
});

test("review summary exact settlement guard uses the same filtered settled-hit population as payout aggregation", () => {
  assert.match(source, /makeWhere\("returned = 0 AND result IS NOT NULL AND selection = result", \[\]\)/u);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/u);
  assert.match(source, /WHEN '3連複' THEN 'trio'/u);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/u);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/u);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/u);
});
