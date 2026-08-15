import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const patternSource = readFileSync(new URL("../../scripts/analyze-buy-outcome-patterns.ts", import.meta.url), "utf8");
const summarySource = readFileSync(new URL("../../scripts/report-buy-learning-summary.ts", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../../.github/workflows/owner-buy-learning-refresh.yml", import.meta.url), "utf8");

test("BUY outcome learning uses realized settlement economics instead of decision-time odds", () => {
  for (const source of [patternSource, summarySource]) {
    assert.match(source, /payout_yen IS NOT NULL/);
    assert.match(source, /payout_yen \/ 100\.0/);
    assert.doesNotMatch(source, /THEN current_odds ELSE 0/);
  }
});

test("automatic outcome learning is scoped to paper-live decisions", () => {
  const matches = workflowSource.match(/--run-kind paper-live/g) ?? [];
  assert.equal(matches.length, 2);
  assert.match(patternSource, /--run-kind/);
  assert.match(summarySource, /--run-kind/);
});

test("PR CI completions cannot cancel a queued main BUY learning refresh", () => {
  assert.match(workflowSource, /workflow_run:[\s\S]*?branches: \[main\]/);
  assert.match(workflowSource, /group: owner-buy-learning-refresh/);
  assert.match(workflowSource, /cancel-in-progress: true/);
});
