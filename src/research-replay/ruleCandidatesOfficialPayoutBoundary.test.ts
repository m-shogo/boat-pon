import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("rule candidates classify ROI from official payouts and fail closed on missing hit payouts", () => {
  const source = readFileSync("scripts/report-rule-candidates.ts", "utf8");

  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /row\.missingPayoutHits === 0/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout/);
});
