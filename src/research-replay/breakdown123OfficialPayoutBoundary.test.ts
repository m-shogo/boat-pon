import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("1-2-3 breakdown fails closed until ROI uses complete official trifecta payouts", () => {
  const source = readFileSync("scripts/analyze-123-breakdown.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.["analyze:123-breakdown"], "tsx scripts/analyze-123-breakdown.ts");
  assert.match(source, /BREAKDOWN_123_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(source, /trifecta race_payouts\.payout_yen/);
  assert.match(source, /complete official settlement coverage/);
  assert.doesNotMatch(source, /DatabaseSync/);
  assert.doesNotMatch(source, /result=selection THEN current_odds/);
  assert.doesNotMatch(source, /writeFileSync/);
});
