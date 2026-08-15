import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const patternSource = readFileSync(new URL("../../scripts/analyze-buy-outcome-patterns.ts", import.meta.url), "utf8");
const summarySource = readFileSync(new URL("../../scripts/report-buy-learning-summary.ts", import.meta.url), "utf8");

test("BUY outcome learning uses realized settlement economics instead of decision-time odds", () => {
  for (const source of [patternSource, summarySource]) {
    assert.match(source, /payout_yen IS NOT NULL/);
    assert.match(source, /payout_yen \/ 100\.0/);
    assert.doesNotMatch(source, /THEN current_odds ELSE 0/);
  }
});

test("BUY outcome learning scripts expose an explicit run-kind boundary", () => {
  assert.match(patternSource, /--run-kind/);
  assert.match(summarySource, /--run-kind/);
});
