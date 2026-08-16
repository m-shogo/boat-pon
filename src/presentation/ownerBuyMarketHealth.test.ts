import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyLearningSummary } from "./buyLearningSummary";
import { buildOwnerBuyMarketHealth, unavailableOwnerBuyMarketHealth, validateOwnerBuyMarketHealth } from "./ownerBuyMarketHealth";

const learning = () => buildBuyLearningSummary({
  generatedAt: "2026-08-16T02:18:38Z", totalDecisions: 61, settled: 61, hits: 2,
  payoutOddsSum: 68.3, maxPayoutOdds: 40, avgEstimatedHitRate: 0.0606,
  recentSettled: 30, recentHits: 1, recentPayoutOddsSum: 40.3,
  smallSampleMisses: 0, highConfidenceMisses: 0, highEvMisses: 59,
});

function calibration(): any {
  const overall = { eligible: 61, expectedHits: 1.4792, observedHits: 2, averagePredictedHitRate: 0.0242, observedHitRate: 0.0328, calibrationBias: -0.0085, brierScore: 0.0317, classification: "WITHIN_5PT" };
  const recent = { eligible: 30, expectedHits: 0.7291, observedHits: 1, averagePredictedHitRate: 0.0243, observedHitRate: 0.0333, calibrationBias: -0.009, brierScore: 0.0323, classification: "WITHIN_5PT" };
  return {
    schemaVersion: "buy-probability-calibration-public-v4", productionChangeAllowed: false,
    overall: { status: "AVAILABLE", settled: 61, probabilityEligible: 61, missingProbability: 0, probabilityCoverage: 1, minimumTrials: 30, missingEligibleToEvaluate: 0, metrics: overall },
    stability: { status: "STABLE_WITHIN_5PT", windowSize: 30, requiredSettled: 60, totalSettled: 61, missingSettledToCompare: 0, recent: { settled: 30, probabilityEligible: 30, missingProbability: 0, metrics: recent }, prior: { settled: 30, probabilityEligible: 30, missingProbability: 0, metrics: { ...recent, averagePredictedHitRate: 0.0242, calibrationBias: -0.0091 } }, productionChangeAllowed: false },
    probabilityPipeline: { overall: {
      settled: 61,
      stages: { featureAdjusted: { eligible: 61, missing: 0, coverage: 1, averageProbability: 0.0606 }, decisionEffective: { eligible: 61, missing: 0, coverage: 1, averageProbability: 0.0242 } },
      transitions: { featureAdjustedToDecisionEffective: { paired: 61, retentionRatio: 0.4 } },
    } },
  };
}

function roi(): any {
  return {
    schemaVersion: "buy-roi-uncertainty-public-v1", productionChangeAllowed: false,
    performance: { status: "AVAILABLE", trials: 61, interval: { pointEstimate: 1.1197, lower: 0, upper: 2.9 } },
    recent: { status: "AVAILABLE", trials: 30, interval: { pointEstimate: 1.3433, lower: 0, upper: 4.03 } },
    expectationRealization: {
      performance: { status: "AVAILABLE", trials: 61, expectedEvEligible: 61, missingExpectedEv: 0, averageStoredEv: 1.5381, realizedRoi: 1.1197, realizedToExpectedRatio: 0.728, classification: "CROSSES_EXPECTED" },
      recent: { status: "AVAILABLE", trials: 30, expectedEvEligible: 30, missingExpectedEv: 0, averageStoredEv: 1.5567, realizedRoi: 1.3433, realizedToExpectedRatio: 0.8629, classification: "CROSSES_EXPECTED" },
    },
    priceRealization: {
      minimumHits: 5,
      performance: { status: "INSUFFICIENT_HIT_SUPPORT", hits: 2, minimumHits: 5, missingHits: 3, averageDecisionPriceProxy: null, averageRealizedPriceProxy: null, realizedToDecisionRatio: null, averagePriceGap: null },
      recent: { status: "INSUFFICIENT_HIT_SUPPORT", hits: 1, minimumHits: 5, missingHits: 4, averageDecisionPriceProxy: null, averageRealizedPriceProxy: null, realizedToDecisionRatio: null, averagePriceGap: null },
    },
  };
}

test("builds public-safe market health from one matching BUY cohort", () => {
  const value = buildOwnerBuyMarketHealth({ generatedAt: "2026-08-16T02:19:00Z", buyLearning: learning(), calibration: calibration(), roiUncertainty: roi() });
  assert.equal(value.status, "AVAILABLE");
  assert.equal(value.probability?.decisionEffectiveHitRate, 0.0242);
  assert.equal(value.probability?.observedHitRate, 0.0328);
  assert.equal(value.probability?.featureToDecisionRetention, 0.4);
  assert.equal(value.evRealization?.performance.realizedToExpectedRatio, 0.728);
  assert.deepEqual(value.priceReadiness?.performance, { status: "INSUFFICIENT_HIT_SUPPORT", hits: 2, minimumHits: 5, missingHits: 3 });
  assert.deepEqual(validateOwnerBuyMarketHealth(value), []);
  assert.doesNotMatch(JSON.stringify(value), /venue|selection|currentOdds|requiredOdds|stake|raceId|decisionId|segmentKey/i);
});

test("fails closed on stale cohorts and price leakage below five hits", () => {
  const stale = calibration(); stale.overall.settled = 60;
  assert.throws(() => buildOwnerBuyMarketHealth({ generatedAt: "2026-08-16T02:19:00Z", buyLearning: learning(), calibration: stale, roiUncertainty: roi() }), /cohort mismatch/u);
  const leaked = roi(); leaked.priceRealization.performance.averageDecisionPriceProxy = 40;
  assert.throws(() => buildOwnerBuyMarketHealth({ generatedAt: "2026-08-16T02:19:00Z", buyLearning: learning(), calibration: calibration(), roiUncertainty: leaked }), /leaked value below support floor/u);
});

test("NOT_AVAILABLE is explicit", () => {
  const value = unavailableOwnerBuyMarketHealth("2026-08-16T02:19:00Z");
  assert.equal(value.status, "NOT_AVAILABLE");
  assert.equal(value.probability, null);
  assert.deepEqual(validateOwnerBuyMarketHealth(value), []);
});
