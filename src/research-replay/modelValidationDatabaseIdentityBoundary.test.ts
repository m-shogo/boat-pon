import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("model validation fails closed until realized returns use complete official payouts", () => {
  const source = readFileSync("scripts/validate-model.ts", "utf8");

  assert.match(source, /MODEL_VALIDATION_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(source, /race_payouts\.payout_yen/);
  assert.match(source, /complete official settlement coverage/);
  assert.doesNotMatch(source, /DatabaseSync/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN selection = result THEN current_odds/);
  assert.doesNotMatch(source, /writeFileSync/);
});
