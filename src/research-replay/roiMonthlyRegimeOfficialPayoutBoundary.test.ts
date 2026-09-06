import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-monthly-regime.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal ROI monthly-regime command fails closed instead of classifying on quote-based realized returns", () => {
  assert.equal(pkg.scripts?.["analyze:roi-monthly-regime"], "tsx scripts/analyze-roi-monthly-regime.ts");
  assert.match(entrypoint, /ROI_MONTHLY_REGIME_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.match(entrypoint, /complete settlement coverage/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
  assert.doesNotMatch(entrypoint, /REGIME_PAPER_STRONG/);
  assert.doesNotMatch(entrypoint, /REGIME_WEAK_MONTH/);
  assert.doesNotMatch(entrypoint, /NO_BUY候補/);
});
