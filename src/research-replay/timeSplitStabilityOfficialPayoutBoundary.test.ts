import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("time split stability uses official payouts and treats missing payout windows as insufficient", () => {
  const source = readFileSync("scripts/report-time-split-stability.ts", "utf8");

  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /beforeMissingPayoutHits > 0 \|\| row\.afterMissingPayoutHits > 0\) return "insufficient"/);
  assert.match(source, /beforeRoi == null \|\| row\.beforeRoiExMax == null \|\| row\.afterRoi == null \|\| row\.afterRoiExMax == null\) return "insufficient"/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});
