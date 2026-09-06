import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bad-condition discovery fails closed until ROI uses complete official payouts", () => {
  const source = readFileSync("scripts/analyze-roi-bad-conditions.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.["analyze:roi-bad-conditions"], "tsx scripts/analyze-roi-bad-conditions.ts");
  assert.match(source, /ROI_BAD_CONDITIONS_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(source, /race_payouts\.payout_yen/);
  assert.match(source, /complete official settlement coverage/);
  assert.doesNotMatch(source, /DatabaseSync/);
  assert.doesNotMatch(source, /result=selection THEN current_odds/);
  assert.doesNotMatch(source, /writeFileSync/);
});
