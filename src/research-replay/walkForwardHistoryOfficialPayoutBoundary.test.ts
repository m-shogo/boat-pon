import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/walk-forward-history.ts", "utf8");

test("walk-forward history maps decision bet types into canonical payout namespaces", () => {
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /assertSupportedBetTypeMapping\(db, range\.from, range\.to\)/);
  assert.match(source, /WALK_FORWARD_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /rp\.bet_type = s\.payout_bet_type/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
});

test("walk-forward history uses official payouts and excludes missing-payout windows from verdicts", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /missingPayoutHits > 0 \|\| roi == null\) return "incomplete"/);
  assert.match(source, /row\.status !== "no_sample" && row\.status !== "incomplete"/);
  assert.match(source, /incompleteWindows: incomplete/);
  assert.doesNotMatch(source, /row\.current_odds \?\? 0/);
});

test("walk-forward history validates every settled BUY denominator before LIMIT 1 or window verdicts", () => {
  const mappingIndex = source.indexOf("assertSupportedBetTypeMapping(db, range.from, range.to)");
  const integrityIndex = source.indexOf("assertWinningSettlementIntegrity(db, range.from, range.to)");
  const rowsIndex = source.indexOf("listRows(db, range.from, range.to)");

  assert.ok(mappingIndex >= 0);
  assert.ok(integrityIndex > mappingIndex);
  assert.ok(rowsIndex > integrityIndex);
  assert.match(source, /WITH relevant_settled AS/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*result/);
  assert.match(source, /decision = 'BUY'/);
  assert.match(source, /returned = 0/);
  assert.match(source, /result IS NOT NULL/);
  assert.match(source, /result != ''/);
  assert.doesNotMatch(source, /relevant_hits AS/);
  assert.doesNotMatch(source, /selection = result[\s\S]*\), invalid AS/);
  assert.match(source, /s\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.combination = s\.result/);
  assert.match(source, /\) != 1/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /WALK_FORWARD_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

test("walk-forward payout scalar lookup is constrained to the validated positive non-refund winning key", () => {
  assert.match(source, /rp\.combination = decision_history\.selection\n        AND rp\.returned = 0\n        AND rp\.payout_yen > 0\n      LIMIT 1/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});
