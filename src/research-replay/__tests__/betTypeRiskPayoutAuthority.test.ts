import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bet type risk-factor ROI fails closed on incomplete, malformed, or refund-only official payouts", () => {
  const source = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /BET_TYPE_RISK_BUY_POPULATION_EMPTY/);
  assert.match(source, /BET_TYPE_RISK_PAYOUT_INVALID_LINE/);
  assert.match(source, /BET_TYPE_RISK_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella"\] as const/);
  assert.ok((source.match(/rp\.returned != 1/g) ?? []).length >= 2);
  assert.match(source, /rp\.payout_yen IS NULL OR rp\.payout_yen <= 0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
  const populationCheck = source.indexOf("BET_TYPE_RISK_BUY_POPULATION_EMPTY");
  const malformedCheck = source.indexOf("BET_TYPE_RISK_PAYOUT_INVALID_LINE");
  const coverageCheck = source.indexOf("BET_TYPE_RISK_PAYOUT_COVERAGE_INCOMPLETE");
  assert.ok(populationCheck >= 0 && malformedCheck > populationCheck && coverageCheck > malformedCheck);
});
