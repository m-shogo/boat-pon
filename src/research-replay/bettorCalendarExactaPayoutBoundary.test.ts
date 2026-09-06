import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("bettor-calendar ROI fails closed on incomplete official exacta payouts", () => {
  const source = readFileSync("scripts/analyze-bettor-calendar.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(rows\)/);
  assert.match(source, /BETTOR_CALENDAR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});
