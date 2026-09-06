import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("racer relationship market screen uses canonical historical exacta authority", () => {
  const source = readFileSync("scripts/analyze-racer-relationship-market.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("racer relationship ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-racer-relationship-market.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(exacta\)/);
  assert.match(source, /RACER_RELATIONSHIP_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /row\.payout_yen \?\? 0/);
});
