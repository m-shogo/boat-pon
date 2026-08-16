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

test("all-high-EV BUY cohort is not mislabeled as a high-EV failure pattern", () => {
  const summary = buildBuyLearningSummary({
    generatedAt: "2026-08-16T02:40:00Z",
    totalDecisions: 61,
    settled: 61,
    hits: 2,
    payoutOddsSum: 68.3,
    maxPayoutOdds: 40,
    avgEstimatedHitRate: 0.0606,
    avgDecisionEffectiveHitRate: 0.0242,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 40.3,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvSettled: 61,
    highEvMisses: 59,
  });
  assert.ok(summary.learnings.some((item) => item.id === "HIGH_EV_BASELINE_UNINFORMATIVE"));
  assert.equal(summary.learnings.some((item) => item.id === "HIGH_EV_MISSES"), false);
  assert.equal(summary.failurePatterns.some((item) => item.id === "HIGH_EV"), false);
  assert.equal(summary.researchCandidates.some((item) => item.id.includes("HIGH_EV")), false);
  assert.equal(summary.learnings.some((item) => item.id === "CALIBRATION_GAP"), false);
});

test("high-EV failure learning requires supported high-EV and non-high-EV sides", () => {
  const pending = buildBuyLearningSummary({
    generatedAt: "2026-08-16T02:41:00Z",
    totalDecisions: 50,
    settled: 50,
    hits: 5,
    payoutOddsSum: 50,
    maxPayoutOdds: 10,
    avgEstimatedHitRate: 0.2,
    avgDecisionEffectiveHitRate: 0.08,
    recentSettled: 30,
    recentHits: 3,
    recentPayoutOddsSum: 30,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvSettled: 40,
    highEvMisses: 35,
  });
  assert.ok(pending.learnings.some((item) => item.id === "HIGH_EV_COMPARISON_PENDING"));
  assert.equal(pending.failurePatterns.some((item) => item.id === "HIGH_EV"), false);

  const comparable = buildBuyLearningSummary({
    generatedAt: "2026-08-16T02:42:00Z",
    totalDecisions: 80,
    settled: 80,
    hits: 10,
    payoutOddsSum: 80,
    maxPayoutOdds: 10,
    avgEstimatedHitRate: 0.2,
    avgDecisionEffectiveHitRate: 0.08,
    recentSettled: 30,
    recentHits: 4,
    recentPayoutOddsSum: 30,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvSettled: 40,
    highEvMisses: 34,
  });
  assert.ok(comparable.learnings.some((item) => item.id === "HIGH_EV_MISSES"));
  assert.ok(comparable.failurePatterns.some((item) => item.id === "HIGH_EV"));
});

test("effective BUY probability overrides pre-calibration estimate for calibration-gap learning", () => {
  const summary = buildBuyLearningSummary({
    generatedAt: "2026-08-16T02:43:00Z",
    totalDecisions: 100,
    settled: 100,
    hits: 3,
    payoutOddsSum: 100,
    maxPayoutOdds: 10,
    avgEstimatedHitRate: 0.2,
    avgDecisionEffectiveHitRate: 0.04,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 30,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvSettled: 100,
    highEvMisses: 97,
  });
  assert.equal(summary.learnings.some((item) => item.id === "CALIBRATION_GAP"), false);
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
