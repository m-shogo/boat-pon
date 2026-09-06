import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("all-bet-type screening direct analyzer fails closed on incomplete settlement coverage", () => {
  const source = readFileSync("scripts/analyze-all-bet-type-screening.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /const REQUIRED_BET_TYPES = \["trifecta", "trio", "exacta", "quinella", "wide"\] as const/);
  assert.match(source, /assertPayoutCompleteness\(\)/);
  assert.match(source, /ALL_BET_TYPE_SCREENING_BUY_POPULATION_EMPTY/);
  assert.match(source, /ALL_BET_TYPE_SCREENING_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /coverage欠損はfail-closed/);
  assert.doesNotMatch(source, /coverage 欠損レースは「外れ扱い」/);
  assert.doesNotMatch(source, /payoutIndex\.set\(key, p\.payout_yen \?\? 0\)/);
});
