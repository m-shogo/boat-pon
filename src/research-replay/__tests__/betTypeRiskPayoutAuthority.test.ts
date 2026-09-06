import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bet type risk-factor ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /BET_TYPE_RISK_BUY_POPULATION_EMPTY/);
  assert.match(source, /BET_TYPE_RISK_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella"\] as const/);
  assert.match(source, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
});
