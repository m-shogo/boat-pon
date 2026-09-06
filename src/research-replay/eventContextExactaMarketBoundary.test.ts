import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event-context screen uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-event-market-context.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("event-context screen fails closed on database identity and settlement completeness", () => {
  const source = readFileSync("scripts/analyze-event-market-context.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertSettlementCompleteness\(\);/);
  assert.match(source, /EVENT_MARKET_CONTEXT_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /payout_yen IS NOT NULL AND payout_yen > 0/);
  assert.match(source, /requiredPayout\(row\)/);
  assert.match(source, /EVENT_MARKET_CONTEXT_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source, /row\.payout_yen \?\? 0/);
});
