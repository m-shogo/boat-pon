import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("calibration stability direct analyzer fails closed on incomplete hit payouts", () => {
  const source = readFileSync("scripts/analyze-calibration-stability.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(train, "train"\)/);
  assert.match(source, /assertPayoutCompleteness\(forward, "forward"\)/);
  assert.match(source, /CALIBRATION_STABILITY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /hits\.map\(requiredPayout\)/);
  assert.match(source, /requiredPayout\(b\.r\) > requiredPayout\(a\.r\)/);
  assert.doesNotMatch(source, /payout_yen \?\? 0/);
});
