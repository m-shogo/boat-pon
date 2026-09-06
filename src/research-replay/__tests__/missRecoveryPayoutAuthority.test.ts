import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("miss recovery classification fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /MISS_RECOVERY_BUY_POPULATION_EMPTY/);
  assert.match(source, /MISS_RECOVERY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /const BET_TYPES = \["trifecta", "trio", "exacta", "quinella", "wide"\] as const/);
  assert.match(source, /p\.payout_yen != null && p\.payout_yen > 0/);
  assert.doesNotMatch(source, /payoutIndex\.set\(key, p\.payout_yen \?\? 0\)/);
});
