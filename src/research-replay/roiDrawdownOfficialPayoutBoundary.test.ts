import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-drawdown.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal ROI drawdown command fails closed instead of judging operations on current odds", () => {
  assert.equal(pkg.scripts?.["analyze:roi-drawdown"], "tsx scripts/analyze-roi-drawdown.ts");
  assert.match(entrypoint, /ROI_DRAWDOWN_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
});
