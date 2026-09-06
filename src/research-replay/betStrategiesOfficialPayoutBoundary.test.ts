import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-bet-strategies.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal bet-strategy command fails closed instead of using quote odds as realized payout", () => {
  assert.equal(pkg.scripts?.["analyze:bet-strategies"], "tsx scripts/analyze-bet-strategies.ts");
  assert.match(entrypoint, /BET_STRATEGIES_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
  assert.doesNotMatch(entrypoint, /current_odds/);
});
