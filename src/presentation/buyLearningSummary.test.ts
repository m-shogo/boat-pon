import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyLearningSummary, unavailableBuyLearningSummary, validateBuyLearningSummary } from "./buyLearningSummary";

test("buildBuyLearningSummary derives performance and research candidates without exposing raw BUY fields", () => {
  const summary = buildBuyLearningSummary({
    generatedAt: "2026-08-15T06:40:00Z",
    from: "2026-07-01",
    to: "2026-08-15",
    totalDecisions: 60,
    settled: 50,
    hits: 8,
    payoutOddsSum: 34.5,
    maxPayoutOdds: 12.0,
    avgEstimatedHitRate: 0.28,
    recentSettled: 20,
    recentHits: 4,
    recentPayoutOddsSum: 16.2,
    smallSampleMisses: 7,
    highConfidenceMisses: 3,
    highEvMisses: 5,
  });
  assert.equal(summary.status, "AVAILABLE");
  assert.equal(summary.performance.settled, 50);
  assert.equal(summary.performance.misses, 42);
  assert.equal(summary.performance.roi, 0.69);
  assert.ok(summary.learnings.some((item) => item.id === "ROI_BELOW_BREAK_EVEN"));
  assert.ok(summary.researchCandidates.every((item) => item.productionChangeAllowed === false));
  assert.deepEqual(validateBuyLearningSummary(summary), []);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("selection"), false);
  assert.equal(serialized.includes("currentOdds"), false);
  assert.equal(serialized.includes("stake"), false);
});

test("unavailable summary fails safe without inferred zeroes", () => {
  const summary = unavailableBuyLearningSummary("2026-08-15T06:40:00Z");
  assert.equal(summary.status, "NOT_AVAILABLE");
  assert.equal(summary.performance.settled, null);
  assert.equal(summary.performance.roi, null);
  assert.deepEqual(validateBuyLearningSummary(summary), []);
});

test("validator rejects private operational markers", () => {
  const summary = unavailableBuyLearningSummary("2026-08-15T06:40:00Z") as unknown as Record<string, unknown>;
  summary.selection = "1-2-3";
  assert.ok(validateBuyLearningSummary(summary).some((error) => error.includes("selection")));
});
