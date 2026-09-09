import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-point-in-time-leak-impact.ts", "utf8");

test("point-in-time leak impact markdown summary is derived from current report data", () => {
  assert.match(source, /const nonNeutral = s\.factorDistribution\.positive \+ s\.factorDistribution\.negative/);
  assert.match(source, /s\.scope\.rowsWithBreakdown/);
  assert.match(source, /s\.decisionImpact\.buyChangedToSkip/);
  assert.match(source, /s\.decisionImpact\.skipChangedToBuy/);
  assert.match(source, /s\.scope\.buyDecisionsWithoutBreakdown/);
});

test("point-in-time leak impact summary does not preserve stale dataset-specific claims", () => {
  assert.doesNotMatch(source, /2975 行/);
  assert.doesNotMatch(source, /2,272件/);
  assert.doesNotMatch(source, /2,271件/);
  assert.doesNotMatch(source, /徳山R8 2025-01-05/);
  assert.doesNotMatch(source, /98%超/);
});
