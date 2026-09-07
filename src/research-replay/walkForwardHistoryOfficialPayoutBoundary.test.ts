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

test("walk-forward history fails closed before LIMIT 1 can choose an ambiguous winning settlement", () => {
  const source = readFileSync("scripts/walk-forward-history.ts", "utf8");
  const integrityIndex = source.indexOf("assertWinningSettlementIntegrity(db, range.from, range.to)");
  const rowsIndex = source.indexOf("listRows(db, range.from, range.to)");

  assert.ok(integrityIndex >= 0);
  assert.ok(rowsIndex > integrityIndex);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /decision = 'BUY'/);
  assert.match(source, /returned = 0/);
  assert.match(source, /selection = result/);
  assert.match(source, /\) != 1/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /WALK_FORWARD_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

test("walk-forward payout scalar lookup is constrained to the validated positive non-refund winning key", () => {
  const source = readFileSync("scripts/walk-forward-history.ts", "utf8");

  assert.match(source, /rp\.combination = decision_history\.selection\n        AND rp\.returned = 0\n        AND rp\.payout_yen > 0\n      LIMIT 1/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
