import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyLearningSummary } from "./buyLearningSummary";
import { buildOwnerBuyEvidenceDiagnostics, unavailableOwnerBuyEvidenceDiagnostics, validateOwnerBuyEvidenceDiagnostics } from "./ownerBuyEvidenceDiagnostics";

const learning = buildBuyLearningSummary({
  generatedAt: "2026-08-15T12:39:43.000Z",
  totalDecisions: 61,
  settled: 61,
  hits: 2,
  payoutOddsSum: 68.3,
  maxPayoutOdds: 40,
  avgEstimatedHitRate: 0.03,
  recentSettled: 30,
  recentHits: 1,
  recentPayoutOddsSum: 40.3,
  smallSampleMisses: 0,
  highConfidenceMisses: 0,
  highEvMisses: 10,
});

const patterns = {
  schemaVersion: "buy-outcome-pattern-public-v1",
  generatedAt: "2026-08-15T12:39:42.000Z",
  status: "NO_SIGNAL",
  analyzedSettled: 61,
  support: {
    status: "NO_SUPPORTED_CONTRAST",
    baselineSettled: 61,
    minimumSettledPerSide: 30,
    minimumTotalSettledForAnyContrast: 60,
    globalAdditionalSettledForAnyContrast: 0,
    validSegmentCount: 21,
    segmentSideEligibleCount: 5,
    universalEligibleSegmentCount: 5,
    closestObservedComplementSettled: 0,
    minimumObservedComplementShortfall: 30,
    contrastBlocker: "UNIVERSAL_SEGMENT_COVERAGE",
    supportedContrastCount: 0,
    supportedDimensionCount: 0,
  },
  noSignalReason: "NO_SUPPORTED_CONTRAST",
  signals: [],
  productionChangeAllowed: false,
};

const tail = {
  schemaVersion: "buy-tail-dependence-public-v1",
  generatedAt: "2026-08-15T12:39:42.100Z",
  status: "PERSISTENT_TAIL_DEPENDENCE",
  windowSize: 30,
  minimumTailGap: 0.15,
  totalSettled: 61,
  support: { recentSettled: 30, priorSettled: 30, missingSettledToCompare: 0 },
  recent: { settled: 30, hits: 1, roi: 1.3433, roiExMax: 0, tailGap: 1.3433, tailDependent: true },
  prior: { settled: 30, hits: 1, roi: 0.9667, roiExMax: 0.0334, tailGap: 0.9333, tailDependent: true },
  productionChangeAllowed: false,
};

const uncertainty = {
  schemaVersion: "buy-hit-rate-uncertainty-public-v1",
  generatedAt: "2026-08-15T12:39:43.500Z",
  status: "AVAILABLE",
  performance: { confidenceLevel: 0.95, method: "WILSON_SCORE", trials: 61, successes: 2, pointEstimate: 0.0328, lower: 0.009, upper: 0.1119, width: 0.1029 },
  recent: { confidenceLevel: 0.95, method: "WILSON_SCORE", trials: 30, successes: 1, pointEstimate: 0.0333, lower: 0.0059, upper: 0.1667, width: 0.1608 },
  note: "95% Wilson score intervals describe binomial hit-rate uncertainty only; they do not estimate payout ROI uncertainty.",
  productionChangeAllowed: false,
};

const roiUncertainty = {
  schemaVersion: "buy-roi-uncertainty-public-v1",
  generatedAt: "2026-08-15T12:39:43.700Z",
  status: "AVAILABLE",
  minimumTrials: 30,
  performance: {
    status: "AVAILABLE",
    trials: 61,
    minimumTrials: 30,
    missingTrials: 0,
    interval: { confidenceLevel: 0.95, method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP", trials: 61, iterations: 5000, pointEstimate: 1.1197, lower: 0, upper: 3, width: 3, breakEven: 1, classification: "CROSSES_BREAK_EVEN" },
  },
  recent: {
    status: "AVAILABLE",
    trials: 30,
    minimumTrials: 30,
    missingTrials: 0,
    interval: { confidenceLevel: 0.95, method: "DETERMINISTIC_PERCENTILE_BOOTSTRAP", trials: 30, iterations: 5000, pointEstimate: 1.3433, lower: 0, upper: 4, width: 4, breakEven: 1, classification: "CROSSES_BREAK_EVEN" },
  },
  expectationRealization: {
    performance: { status: "AVAILABLE", trials: 61, expectedEvEligible: 61, missingExpectedEv: 0, minimumTrials: 30, averageStoredEv: 1.4, realizedRoi: 1.1197, realizedToExpectedRatio: 0.7998, classification: "CROSSES_EXPECTED" },
    recent: { status: "AVAILABLE", trials: 30, expectedEvEligible: 30, missingExpectedEv: 0, minimumTrials: 30, averageStoredEv: 1.4, realizedRoi: 1.3433, realizedToExpectedRatio: 0.9595, classification: "CROSSES_EXPECTED" },
  },
  priceRealization: {
    minimumHits: 5,
    performance: { status: "INSUFFICIENT_HIT_SUPPORT", hits: 2, priceEligibleHits: 2, minimumHits: 5, missingHits: 3, averageDecisionPriceProxy: null, averageRealizedPriceProxy: null, realizedToDecisionRatio: null, averagePriceGap: null },
    recent: { status: "INSUFFICIENT_HIT_SUPPORT", hits: 1, priceEligibleHits: 1, minimumHits: 5, missingHits: 4, averageDecisionPriceProxy: null, averageRealizedPriceProxy: null, averagePriceGap: null, realizedToDecisionRatio: null },
  },
  note: "descriptive only",
  productionChangeAllowed: false,
};

test("builds strict public-safe evidence diagnostics from the same settled BUY cohort", () => {
  const diagnostics = buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns,
    tail,
    uncertainty,
    roiUncertainty,
  });
  assert.equal(diagnostics.status, "AVAILABLE");
  assert.equal(diagnostics.schemaVersion, "owner-buy-evidence-diagnostics-v3");
  assert.equal(diagnostics.patternSupport?.status, "NO_SUPPORTED_CONTRAST");
  assert.equal(diagnostics.patternSupport?.analyzedSettled, 61);
  assert.equal(diagnostics.patternSupport?.validSegmentCount, 21);
  assert.equal(diagnostics.patternSupport?.segmentSideEligibleCount, 5);
  assert.equal(diagnostics.patternSupport?.universalEligibleSegmentCount, 5);
  assert.equal(diagnostics.patternSupport?.closestObservedComplementSettled, 0);
  assert.equal(diagnostics.patternSupport?.minimumObservedComplementShortfall, 30);
  assert.equal(diagnostics.patternSupport?.contrastBlocker, "UNIVERSAL_SEGMENT_COVERAGE");
  assert.equal(diagnostics.tailStability?.status, "PERSISTENT_TAIL_DEPENDENCE");
  assert.equal(diagnostics.tailStability?.recentTailGap, 1.3433);
  assert.equal(diagnostics.hitRateUncertainty?.performance.lower, 0.009);
  assert.equal(diagnostics.hitRateUncertainty?.performance.upper, 0.1119);
  assert.equal(diagnostics.roiUncertainty?.performance.interval?.pointEstimate, 1.1197);
  assert.equal(diagnostics.roiUncertainty?.performance.interval?.classification, "CROSSES_BREAK_EVEN");
  assert.equal("expectationRealization" in diagnostics, false);
  assert.equal("priceRealization" in diagnostics, false);
  assert.equal(diagnostics.productionChangeAllowed, false);
  assert.deepEqual(validateOwnerBuyEvidenceDiagnostics(diagnostics), []);
  assert.doesNotMatch(JSON.stringify(diagnostics), /selection|raceId|decisionId|currentOdds|requiredOdds|stake|segmentKey|PRIVATE/i);
});

test("rejects stale or inconsistent evidence sources instead of mixing cohorts", () => {
  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns: { ...patterns, analyzedSettled: 60 },
    tail,
    uncertainty,
    roiUncertainty,
  }), /pattern\/dashboard settled count mismatch/u);

  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns,
    tail: { ...tail, totalSettled: 60 },
    uncertainty,
    roiUncertainty,
  }), /tail\/dashboard settled count mismatch|tail.*support/u);

  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns,
    tail,
    uncertainty: { ...uncertainty, performance: { ...uncertainty.performance, trials: 60 } },
    roiUncertainty,
  }), /Wilson performance count mismatch/u);

  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns,
    tail,
    uncertainty,
    roiUncertainty: { ...roiUncertainty, performance: { ...roiUncertainty.performance, trials: 60 } },
  }), /ROI performance support mismatch/u);

  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns,
    tail,
    uncertainty,
    roiUncertainty: {
      ...roiUncertainty,
      performance: {
        ...roiUncertainty.performance,
        interval: { ...roiUncertainty.performance.interval, pointEstimate: 1.5 },
      },
    },
  }), /ROI performance point estimate mismatch/u);
});

test("rejects contradictory public-safe pattern blocker evidence", () => {
  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns: {
      ...patterns,
      support: {
        ...patterns.support,
        contrastBlocker: "COMPLEMENT_SUPPORT_SHORTFALL",
      },
    },
    tail,
    uncertainty,
    roiUncertainty,
  }), /UNIVERSAL_SEGMENT_COVERAGE blocker mismatch/u);

  assert.throws(() => buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00.000Z",
    buyLearning: learning,
    patterns: {
      ...patterns,
      support: {
        ...patterns.support,
        universalEligibleSegmentCount: 6,
      },
    },
    tail,
    uncertainty,
    roiUncertainty,
  }), /support counts inconsistent/u);
});

test("NOT_AVAILABLE evidence remains explicit and empty", () => {
  const value = unavailableOwnerBuyEvidenceDiagnostics("2026-08-15T12:40:00.000Z");
  assert.equal(value.status, "NOT_AVAILABLE");
  assert.equal(value.patternSupport, null);
  assert.equal(value.hitRateUncertainty, null);
  assert.equal(value.roiUncertainty, null);
  assert.equal(value.tailStability, null);
  assert.deepEqual(validateOwnerBuyEvidenceDiagnostics(value), []);
});