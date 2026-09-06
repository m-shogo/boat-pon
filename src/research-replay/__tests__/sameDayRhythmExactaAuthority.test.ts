import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("same-day rhythm screen binds both base and selection odds to canonical exacta authority", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.equal((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("same-day rhythm ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(market\)/);
  assert.match(source, /SAME_DAY_RHYTHM_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});
