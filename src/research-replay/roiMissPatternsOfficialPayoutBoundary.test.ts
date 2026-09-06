import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-miss-patterns.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

test("normal ROI miss-pattern command fails closed instead of ranking selectors on mixed quote/settlement returns", () => {
  assert.equal(pkg.scripts?.["analyze:roi-miss-patterns"], "tsx scripts/analyze-roi-miss-patterns.ts");
  assert.match(entrypoint, /ROI_MISS_PATTERNS_OFFICIAL_PAYOUT_REQUIRED/);
  assert.match(entrypoint, /official race_payouts\.payout_yen/);
  assert.match(entrypoint, /complete settlement coverage/);
  assert.doesNotMatch(entrypoint, /new DatabaseSync/);
  assert.doesNotMatch(entrypoint, /writeFileSync/);
  assert.doesNotMatch(entrypoint, /currentOdds\s*\*/);
});
