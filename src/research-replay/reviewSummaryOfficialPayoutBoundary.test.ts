import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("review summary derives decision ROI from official payouts and fails closed on missing hit payouts", () => {
  const source = readFileSync("scripts/report-review-summary-raw.ts", "utf8");

  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND\(total_payout_odds/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});
