import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-review-summary-raw.ts", "utf8");

test("review summary validates mapped exact official winning-result settlements before building the summary", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /REVIEW_SUMMARY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
  assert.match(source, /WITH relevant_settled AS/u);
  assert.match(source, /s\.payout_bet_type IS NULL/u);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.race_id = s\.race_id[\s\S]*rp\.bet_type = s\.payout_bet_type[\s\S]*rp\.combination = s\.result/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen IS NOT NULL/u);
  assert.match(source, /rp\.payout_yen > 0/u);

  const guard = source.indexOf("assertOfficialSettlementIntegrity();");
  const summary = source.indexOf("const summary = {");
  assert.ok(guard >= 0 && summary > guard);
});

test("review summary settlement guard covers the full filtered settled denominator, not only hits", () => {
  assert.match(source, /makeWhere\("returned = 0 AND result IS NOT NULL AND result != ''", \[\]\)/u);
  assert.match(source, /SELECT DISTINCT[\s\S]*race_id,[\s\S]*payout_bet_type,[\s\S]*result/u);
  assert.doesNotMatch(source, /relevant_hits AS/u);
  assert.doesNotMatch(source, /makeWhere\("returned = 0 AND result IS NOT NULL AND selection = result"/u);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/u);
  assert.match(source, /WHEN '3連複' THEN 'trio'/u);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/u);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/u);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/u);
});
