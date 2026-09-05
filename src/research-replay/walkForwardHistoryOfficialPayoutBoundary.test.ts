import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("walk-forward history uses official payouts and excludes missing-payout windows from verdicts", () => {
  const source = readFileSync("scripts/walk-forward-history.ts", "utf8");

  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /missingPayoutHits > 0 \|\| roi == null\) return "incomplete"/);
  assert.match(source, /row\.status !== "no_sample" && row\.status !== "incomplete"/);
  assert.match(source, /incompleteWindows: incomplete/);
  assert.doesNotMatch(source, /row\.current_odds \?\? 0/);
});
