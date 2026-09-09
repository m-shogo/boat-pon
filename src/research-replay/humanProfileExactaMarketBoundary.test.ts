import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("human profile market uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-human-profile-market.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds a WHERE a\.race_id=h\.race_id AND a\.bet_type='exacta'\)\s*=\s*30/);
});

test("human profile ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-human-profile-market.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(odds\)/);
  assert.match(source, /HUMAN_PROFILE_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("human profile exacta settlement integrity is preflighted before selected rows", () => {
  const source = readFileSync("scripts/analyze-human-profile-market.ts", "utf8");
  const preflight = source.indexOf("assertSettlementCoverage(coverage)");
  const analysis = source.indexOf("const odds=db.prepare");

  assert.ok(preflight >= 0 && analysis > preflight, "settlement integrity must pass before selected-row aggregation");
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /HUMAN_PROFILE_EXACTA_SETTLEMENT_INTEGRITY_INVALID/);
  assert.match(source, /JOIN race_payouts p ON p\.race_id=h\.race_id AND p\.bet_type='exacta'/);
  assert.match(source, /SELECT COUNT\(\*\) FROM race_payouts rp WHERE rp\.race_id=h\.race_id AND rp\.bet_type='exacta'\)=1/);
  assert.match(source, /p\.returned=0/);
  assert.match(source, /p\.combination IS NOT NULL AND p\.combination!=''/);
  assert.match(source, /p\.payout_yen IS NOT NULL AND p\.payout_yen>0/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=p\.combination/);
  assert.doesNotMatch(source, /LEFT JOIN race_payouts p/);
});
