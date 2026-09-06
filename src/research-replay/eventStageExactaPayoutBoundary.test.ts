import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event-stage market screen keeps canonical complete exacta population", () => {
  const source=readFileSync("scripts/analyze-event-stage-market.ts","utf8");
  assert.match(source,/historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source,/historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source,/HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.match(source,/status_code='F'/);
});

test("event-stage market screen fails closed on DB identity and payout settlement", () => {
  const source=readFileSync("scripts/analyze-event-stage-market.ts","utf8");
  assert.match(source,/assertCanonicalSingleLinkRegularFile\(DB_PATH,"RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source,/new DatabaseSync\(verifiedDbPath,\{readOnly:true\}\)/);
  assert.match(source,/PRAGMA query_only=ON/);
  assert.match(source,/assertSettlementCompleteness\(\);/);
  assert.match(source,/payout_yen IS NOT NULL AND payout_yen>0/);
  assert.match(source,/EVENT_STAGE_MARKET_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source,/requiredPayout/);
  assert.match(source,/EVENT_STAGE_MARKET_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source,/r=>r\.payout_yen\?\?0/);
});
