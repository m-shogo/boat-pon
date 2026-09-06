import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("evaluate:v4 fails closed until realized returns use complete official payouts", () => {
  const source = readFileSync("scripts/evaluate-v4-conservative.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.["evaluate:v4"], "tsx scripts/evaluate-v4-conservative.ts");
  assert.match(source, /V4_EVALUATION_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(source, /race_payouts\.payout_yen/);
  assert.match(source, /complete official settlement coverage/);
  assert.doesNotMatch(source, /DatabaseSync/);
  assert.doesNotMatch(source, /SUM\(CASE WHEN decision='BUY' AND selection = result AND returned = 0 THEN current_odds/);
  assert.doesNotMatch(source, /writeFileSync/);
});
