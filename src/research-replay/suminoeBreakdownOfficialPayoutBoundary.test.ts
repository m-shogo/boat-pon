import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Suminoe breakdown fails closed until ROI uses complete official trifecta payouts", () => {
  const source = readFileSync("scripts/analyze-suminoe-breakdown.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.["analyze:suminoe-breakdown"], "tsx scripts/analyze-suminoe-breakdown.ts");
  assert.match(source, /SUMINOE_BREAKDOWN_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(source, /trifecta race_payouts\.payout_yen/);
  assert.match(source, /complete official settlement coverage/);
  assert.doesNotMatch(source, /DatabaseSync/);
  assert.doesNotMatch(source, /result=selection THEN current_odds/);
  assert.doesNotMatch(source, /writeFileSync/);
});
