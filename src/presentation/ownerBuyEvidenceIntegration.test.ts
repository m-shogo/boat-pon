import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBuyLearningSummary } from "./buyLearningSummary";
import { buildOwnerBuyEvidenceDiagnostics } from "./ownerBuyEvidenceDiagnostics";
import { buildOwnerDashboardSnapshot } from "./ownerDashboardBuilder";
import { validateOwnerDashboardSnapshot } from "./ownerDashboardSnapshot";

const base = {
  generatedAt: "2026-08-15T12:40:00Z",
  canonicalBranch: "main",
  mainSha: "9fa64d1b804cdf23a8acede8be3d446a2ada6e44",
  ciStatus: "PASS" as const,
  openPrCount: 0,
  gitCleanliness: "CLEAN" as const,
  gitUpdatedAt: "2026-08-15T12:39:00Z",
  taskCatalog: { tasks: [] },
  queueState: { tasks: {} },
  currentRun: { updatedAt: "2026-08-15T12:39:00Z", lastResult: "PASS", blocks: [] },
};

function learning(settled = 61) {
  return buildBuyLearningSummary({
    generatedAt: "2026-08-15T12:39:43Z",
    totalDecisions: settled,
    settled,
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
}

function evidence(buyLearning = learning()) {
  return buildOwnerBuyEvidenceDiagnostics({
    generatedAt: "2026-08-15T12:40:00Z",
    buyLearning,
    patterns: {
      schemaVersion: "buy-outcome-pattern-public-v1",
      generatedAt: "2026-08-15T12:39:42Z",
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
        supportedContrastCount: 0,
        supportedDimensionCount: 0,
      },
      noSignalReason: "NO_SUPPORTED_CONTRAST",
      signals: [],
      productionChangeAllowed: false,
    },
    tail: {
      schemaVersion: "buy-tail-dependence-public-v1",
      generatedAt: "2026-08-15T12:39:42Z",
      status: "PERSISTENT_TAIL_DEPENDENCE",
      windowSize: 30,
      minimumTailGap: 0.15,
      totalSettled: 61,
      support: { recentSettled: 30, priorSettled: 30, missingSettledToCompare: 0 },
      recent: { settled: 30, hits: 1, roi: 1.3433, roiExMax: 0, tailGap: 1.3433, tailDependent: true },
      prior: { settled: 30, hits: 1, roi: 0.9667, roiExMax: 0.0334, tailGap: 0.9333, tailDependent: true },
      productionChangeAllowed: false,
    },
    uncertainty: {
      schemaVersion: "buy-hit-rate-uncertainty-public-v1",
      generatedAt: "2026-08-15T12:39:43Z",
      status: "AVAILABLE",
      performance: { confidenceLevel: 0.95, method: "WILSON_SCORE", trials: 61, successes: 2, pointEstimate: 0.0328, lower: 0.009, upper: 0.1119, width: 0.1029 },
      recent: { confidenceLevel: 0.95, method: "WILSON_SCORE", trials: 30, successes: 1, pointEstimate: 0.0333, lower: 0.0059, upper: 0.1667, width: 0.1608 },
      note: "95% Wilson score intervals describe binomial hit-rate uncertainty only; they do not estimate payout ROI uncertainty.",
      productionChangeAllowed: false,
    },
  });
}

test("owner snapshot exposes aggregate BUY evidence without operational identities", () => {
  const buyLearning = learning();
  const snapshot = buildOwnerDashboardSnapshot({ ...base, buyLearning, buyEvidence: evidence(buyLearning) });
  assert.equal(snapshot.buyEvidence.status, "AVAILABLE");
  assert.equal(snapshot.buyEvidence.patternSupport?.status, "NO_SUPPORTED_CONTRAST");
  assert.equal(snapshot.buyEvidence.patternSupport?.supportedContrastCount, 0);
  assert.equal(snapshot.buyEvidence.tailStability?.status, "PERSISTENT_TAIL_DEPENDENCE");
  assert.equal(snapshot.buyEvidence.hitRateUncertainty?.performance.lower, 0.009);
  assert.deepEqual(validateOwnerDashboardSnapshot(snapshot), []);
  assert.doesNotMatch(JSON.stringify(snapshot), /selection|raceId|decisionId|segmentKey|currentOdds|requiredOdds|recommendedAmount|stake|PRIVATE/i);
});

test("owner snapshot degrades stale BUY evidence to NOT_AVAILABLE instead of mixing cohorts", () => {
  const buyLearning = learning(60);
  const snapshot = buildOwnerDashboardSnapshot({ ...base, buyLearning, buyEvidence: evidence() });
  assert.equal(snapshot.buyEvidence.status, "NOT_AVAILABLE");
  assert.equal(snapshot.buyEvidence.patternSupport, null);
  assert.deepEqual(validateOwnerDashboardSnapshot(snapshot), []);
});

test("Owner dashboard copy identifies official settlement unit-stake ROI instead of old decision-time odds proxy", () => {
  const source = readFileSync("src/components/OwnerDashboardSummary.tsx", "utf8");
  assert.match(source, /公式settlement払戻を100円unit-stake/u);
  assert.match(source, /Outcome Evidence Maturity/u);
  assert.doesNotMatch(source, /ROIはdecision-time odds proxy/u);
});
