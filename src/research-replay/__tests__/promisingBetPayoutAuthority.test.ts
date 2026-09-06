import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("promising bet strategy ranking fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /PROMISING_BET_BUY_POPULATION_EMPTY/);
  assert.match(source, /PROMISING_BET_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella", "wide"\] as const/);
  assert.match(source, /p\.payout_yen != null && p\.payout_yen > 0/);
  assert.doesNotMatch(source, /payoutIndex\.set\(key, p\.payout_yen \?\? 0\)/);
});
