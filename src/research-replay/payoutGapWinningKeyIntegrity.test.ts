import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf8");

test("payout-gap preflight requires exact official settlement for each historical winning result key", () => {
  assert.match(audit, /target_winning_keys AS/);
  assert.match(audit, /SELECT DISTINCT race_id, result AS combination/);
  assert.match(audit, /invalid_winning_keys AS/);
  assert.match(audit, /ts\.race_id = twk\.race_id[\s\S]*ts\.combination = twk\.combination/);
  assert.match(audit, /ts\.returned = 0[\s\S]*ts\.payout_yen > 0/);
  assert.match(audit, /invalidWinningKeys/);
  assert.match(audit, /exact-key payout ROI must remain unavailable/);
});

test("exact winning-key integrity remains downstream of the non-returned historical BUY cohort", () => {
  const targetRows = audit.indexOf("WITH target_rows AS");
  const targetWinningKeys = audit.indexOf("target_winning_keys AS");
  const invalidWinningKeys = audit.indexOf("invalid_winning_keys AS");

  assert.ok(targetRows >= 0);
  assert.ok(targetWinningKeys > targetRows);
  assert.ok(invalidWinningKeys > targetWinningKeys);
  assert.match(audit, /target_winning_keys AS \([\s\S]*bet_type = '3連単'[\s\S]*returned = 0/);
});
