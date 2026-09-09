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

test("racer relationship exacta settlement is unambiguous before market aggregation", () => {
  const source = readFileSync("scripts/analyze-racer-relationship-market.ts", "utf8");
  const preflight = source.indexOf("assertSettlementCoverage(coverage)");
  const analysis = source.indexOf("const exacta = db.prepare");

  assert.ok(preflight >= 0 && analysis > preflight, "settlement integrity must pass before market aggregation");
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /RACER_RELATIONSHIP_EXACTA_SETTLEMENT_INTEGRITY_INVALID/);
  assert.match(source, /JOIN race_payouts p ON p\.race_id=h\.race_id AND p\.bet_type='exacta'/);
  assert.match(source, /SELECT COUNT\(\*\) FROM race_payouts rp WHERE rp\.race_id=h\.race_id AND rp\.bet_type='exacta'\)=1/);
  assert.match(source, /p\.returned=0/);
  assert.match(source, /p\.combination IS NOT NULL AND p\.combination!=''/);
  assert.match(source, /p\.payout_yen IS NOT NULL AND p\.payout_yen>0/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=p\.combination/);
  assert.doesNotMatch(source, /LEFT JOIN race_payouts p/);
});
