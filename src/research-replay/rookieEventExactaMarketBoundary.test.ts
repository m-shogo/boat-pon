import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("rookie-event screen uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-rookie-event-edge.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("rookie-event ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-rookie-event-edge.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(evaluations\)/);
  assert.match(source, /ROOKIE_EVENT_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});