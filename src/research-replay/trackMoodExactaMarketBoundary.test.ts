import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("track mood market uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-track-mood-market.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds a WHERE a\.race_id=h\.race_id AND a\.bet_type='exacta'\)\s*=\s*30/);
});

test("track mood ROI fails closed on incomplete or ambiguous official payouts", () => {
  const source = readFileSync("scripts/analyze-track-mood-market.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /returned=0 AND payout_yen IS NOT NULL AND payout_yen>0/);
  assert.match(source, /row\.payout_rows===1&&row\.valid_rows===1/);
  assert.match(source, /row\.payout_rows>1/);
  assert.match(source, /assertPayoutCompleteness\(oddsByRace\)/);
  assert.match(source, /TRACK_MOOD_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("track mood reports publish through exclusive fsynced identity-verified temp files", () => {
  const source = readFileSync("scripts/analyze-track-mood-market.ts", "utf8");

  assert.match(source, /openSync\(tempPath,"wx",0o600\)/);
  assert.match(source, /fsyncSync\(fd\)/);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath,errorCode\)/);
  assert.match(source, /renameSync\(verifiedTempPath,path\)/);
  assert.match(source, /atomicPublish\(JSON_REPORT_PATH/);
  assert.match(source, /atomicPublish\(MARKDOWN_REPORT_PATH/);
  assert.doesNotMatch(source, /writeFileSync\("reports\/track-mood-market-screen\.(?:json|md)"/);
});