import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const path of ["scripts/analyze-buy-outcome-patterns.ts", "scripts/analyze-buy-pattern-replication.ts"]) {
  test(`${path} uses decision-effective probability for confidence bands`, () => {
    const source = readFileSync(path, "utf8");
    assert.match(source, /decision_effective_hit_rate/u);
    assert.match(source, /ev \/ current_odds/u);
    assert.match(source, /settled BUY decision-effective hit rate outside \[0,1\]/u);
    assert.match(source, /confidenceBandProbabilityBasis/u);
    const confidenceBlock = source.match(/SELECT 'confidenceBand'[\s\S]*?UNION ALL/u)?.[0] ?? "";
    assert.match(confidenceBlock, /decision_effective_hit_rate/u);
    assert.doesNotMatch(confidenceBlock, /estimated_hit_rate/u);
  });
}
