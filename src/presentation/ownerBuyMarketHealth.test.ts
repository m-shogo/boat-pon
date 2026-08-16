import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyLearningSummary } from "./buyLearningSummary";
import { buildOwnerBuyMarketHealth, unavailableOwnerBuyMarketHealth, validateOwnerBuyMarketHealth } from "./ownerBuyMarketHealth";

function learning() {
  return buildBuyLearningSummary({
    generatedAt: "2026-08-16T02:18:38Z",
    totalDecisions: 61,
    settled: 61,
    hits: 2,
    payoutOddsSum: 68.3,
    maxPayoutOdds: 40,
    avgEstimatedHitRate: 0.0606,
    recentSettled: 30,
    recentHits: 1,
    recentPayoutOddsSum: 40.3,
    smallSampleMisses: 0,
    highConfidenceMisses: 0,
    highEvMisses: 59,
  });
}

function calibration() {
  const metrics = { eligible: 61, expectedHits: 1.4792, observedHits: 2, averagePredictedHitRate: 0.0242, observedHitRate: 0.0328, calibrationBias: -0.0085, brierScore: 0.0317, classification: "WITHIN_5PT" };
  const windowMetrics = { eligible: 30, expectedHits: 0.7291, observedHits: 1, averagePredictedHitRate: 0.0243, observedHitRate: 0.0333, calibrationBias: -0.009, brierScore: 0.0323, classification: "WITHIN_5PT" };
  return {
    schemaVersion: "buy-probability-calibration-public-v4",
    generatedAt: "2026-08-16T02:18:39Z",
    status: "AVAILABLE",
    overall: { status: "AVAILABLE", settled: 61, probabilityEligible: 61, missingProbability: 0, probabilityCoverage: 1, minimumTrials: 30, missingEligibleToEvaluate: 0, metrics },
    stability: {
      status: "STABLE_WITHIN_5PT",
      windowSize: 30,
      requiredSettled: 60,
      totalSettled: 61,
      missingSettledToCompare: 0,
      recent: { settled: 30, probabilityEligible: 30, missingProbability: 0, metrics: windowMetrics },
      prior: { settled: 30, probabilityEligible: 30, missingProbability: 0, metrics: { ...windowMetrics, averagePredictedHitRate: 0.0242, calibrationBias: -0.0091, brierScore: 0.0322 } },
      productionChangeAllowed: false,
    },
    probabilityPipeline: {
      overall: {
        settled: 61,
        observedHits: 2,
        observedHitRate: 0.0328,
        stages: {
          rawModel: { eligible: 61, missing: 0, coverage: 1, averageProbability: 0.0637, expectedHits: 3.8867 },
          conservativeModel: { eligible: 61, missing: 0, coverage: 1, averageProbability: 0.0616, expectedHits: 3.7546 },
          featureAdjusted: { eligible: 61, missing: 0, coverage: 1, averageProbability: 0.0606, expectedHits: 3.698 },
          decisionEffective: { eligible: 61, missing: 0, coverage: 1, averageProbability: 0.0242, expectedHits: 1.4792 },
        },
        transitions: {
          rawToConservative: { paired: 61, fromAverage: 0.0637, toAverage: 0.0616, delta: -0.0022, retentionRatio: 0.966 },
          conservativeToFeatureAdjusted: { paired: 61, fromAverage: 0.0616, toAverage: 0.0606, delta: -0.0009, retentionRatio: 0.9849 },
          featureAdjustedToDecisionEffective: { paired: 61, fromAverage: 0.0606, toAverage: 0.0242, delta: -0.0364, retentionRatio: 0.4 },
        },
      },
    },
    productionChangeAllowed: false,
  };
}

function roi() {
  return {
    schemaVersion: "buy-roi-uncertainty-public-v1",
    generatedAt: "2026-08-16T02:18:39Z",
    status: "AVAILABLE",
    minimumTrials: 30,
    performance: { status: "AVAILABLE", trials: 61, minimumTrials: 30, missingTrials: 0, interval: { confidenceLevel: 0.95, method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP", trials: 61, iterations: 5000, pointEstimate: 1.1197, lower: 0, upper: 2.9, width: 2.9, breakEven: 1, classification: "CROSSES_BREAK_EVEN" } },
    recent: { status: "AVAILABLE", trials: 30, minimumTrials: 30, missingTrials: 0, interval: { confidenceLevel: 0.95, method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP", trials: 30, iterations: 5000, pointEstimate: 1.3433, lower: 0, upper: 4.03, width: 4.03, breakEven: 1, classification: "CROSSES_BREAK_EVEN" } },
    expectationRealization: {
      performance: { status: "AVAILABLE", trials: 61, expectedEvEligible: 61, missingExpectedEv: 0, minimumTrials: 30, averageStoredEv: 1.5381, realizedRoi: 1.1197, realizedToExpectedRatio: 0.728, classification: "CROSSES_EXPECTED" },
      recent: { status: "AVAILABLE", trials: 30, expectedEvEligible: 30, missingExpectedEv: 0, minimumTrials: 30, averageStoredEv: 1.5567, realizedRoi: 1.3433, realizedToExpectedRatio: 0.8629, classification: "CROSSES_EXPECTED" },
    },
    priceRealization: {
      minimumHits: 5,
      performance: { status: "INSUFFICIENT_HIT_SUPPORT", hits: 2, priceEligibleHits: 2, minimumHits: 5, missingHits: 3, averageDecisionPriceProxy: null, averageRealizedPriceProxy: null, realizedToDecisionRatio: null, averagePriceGap: null },
      recent: { status: "INSUFFICIENT_HIT_SUPPORT", hits: 1, priceEligibleHits: 1, minimumHits: 5, missingHits: 4, averageDecisionPriceProxy: null, averageRealizedPriceProxy: null, realizedToDecisionRatio: null, averagePriceGap: null },
    },
    productionChangeAllowed: false,
  };
}

test("builds strict aggregate market health from matching BUY cohorts", () => {
  const value = buildOwnerBuyMarketHealth({ generatedAt: "2026-08-16T02:19:00Z", buyLearning: learning(), calibration: calibration(), roiUncertainty: roi() });
  assert.equal(value.status, "AVAILABLE");
  assert.deepEqual(value.probability, {
    settled: 61,
    decisionEffectiveHitRate: 0.0242,
    observedHitRate: 0.0328,
    calibrationBias: -0.0085,
    classification: "WITHIN_5PT",
    stability: "STABLE_WITHIN_5PT",
    featureAdjustedHitRate: 0.0606,
    featureToDecisionRetention: 0.4,
  });
  assert.equal(value.evRealization?.performance.averageStoredEv, 1.5381);
  assert.equal(value.evRealization?.performance.realizedToExpectedRatio, 0.728);
  assert.equal(value.evRealization?.performance.classification, "CROSSES_EXPECTED");
  assert.deepEqual(value.priceReadiness?.performance, { status: "INSUFFICIENT_HIT_SUPPORT", hits: 2, minimumHits: 5, missingHits: 3 });
  assert.deepEqual(validateOwnerBuyMarketHealth(value), []);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|venue|selection|currentOdds|requiredOdds|stake|raceId|decisionId|segmentKey/i);
});

test("rejects stale probability cohort instead of mixing it into market health", () => {
  const bad = calibration();
  bad.overall.settled = 60;
  assert.throws(() => buildOwnerBuyMarketHealth({ generatedAt: "2026-08-16T02:19:00Z", buyLearning: learning(), calibration: bad, roiUncertainty: roi() }), /cohort mismatch/u);
});

test("rejects price values below the five-hit privacy/support floor", () => {
  const bad = roi();
  bad.priceRealization.performance.averageDecisionPriceProxy = 40;
  assert.throws(() => buildOwnerBuyMarketHealth({ generatedAt: "2026-08-16T02:19:00Z", buyLearning: learning(), calibration: calibration(), roiUncertainty: bad }), /leaked value below support floor/u);
});

test("NOT_AVAILABLE market health is explicit and empty", () => {
  const value = unavailableOwnerBuyMarketHealth("2026-08-16T02:19:00Z");
  assert.equal(value.status, "NOT_AVAILABLE");
  assert.equal(value.probability, null);
  assert.equal(value.evRealization, null);
  assert.equal(value.priceReadiness, null);
  assert.deepEqual(validateOwnerBuyMarketHealth(value), []);
});
