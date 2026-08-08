import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_METRICS_CALIBRATION_BIN_COUNT,
  N2_METRICS_FIXED_STAKE_YEN,
  N2_METRICS_REQUIRED_COMMON_ROWS,
  buildN2MetricsDefinition,
} from "./n2MetricsContract";

test("N2 metric contract freezes exact common-cohort predictive metrics", () => {
  const definition = buildN2MetricsDefinition();
  assert.equal(definition.status, "FROZEN");
  assert.equal(definition.commonCohort.requiredBaselineCount, 3);
  assert.equal(definition.commonCohort.requiredRaceCount, 20);
  assert.equal(definition.commonCohort.selectionsPerRace, 120);
  assert.equal(definition.commonCohort.requiredPredictionRowCount, N2_METRICS_REQUIRED_COMMON_ROWS);
  assert.equal(definition.commonCohort.requiredPredictionCoverage, 1);
  assert.equal(definition.predictiveMetrics.canonicalEvaluator, "evaluateN2Baseline");
  assert.deepEqual(definition.predictiveMetrics.primary, ["meanLogLoss", "calibrationEce"]);
  assert.equal(definition.predictiveMetrics.calibrationBinCount, N2_METRICS_CALIBRATION_BIN_COUNT);
});

test("N2 metric contract removes ROI ambiguity and fixes 100-yen stake", () => {
  const definition = buildN2MetricsDefinition();
  assert.equal(definition.economicEvaluation.stakeYenPerTicket, N2_METRICS_FIXED_STAKE_YEN);
  assert.equal(definition.economicEvaluation.returnRateBreakEvenPct, 100);
  assert.equal(definition.economicEvaluation.netRoiBreakEvenPct, 0);
  assert.equal(definition.economicEvaluation.zeroStakeRoi, null);
  assert.equal(definition.economicEvaluation.policies.length, 2);
  assert.equal(definition.economicEvaluation.policies[0].policyId, "forced_top1");
  assert.equal(definition.economicEvaluation.policies[1].policyId, "positive_ev_top1");
  assert.equal(definition.economicEvaluation.policies[1].betCondition, "bet only when best expected gross multiple > 1 + epsilon");
});

test("metric contract separates selection-time data from scoring-time settlement", () => {
  const definition = buildN2MetricsDefinition();
  assert.equal(definition.separationRules.economicTicketSelectionMayUseOfficialPayout, false);
  assert.equal(definition.separationRules.economicScoringMayUseOfficialPayoutAfterSelection, true);
  assert.equal(definition.separationRules.forcedTop1MayUseMarketOddsForSelection, false);
  assert.equal(definition.separationRules.positiveEvTop1MayUseMarketOddsForSelection, true);
  assert.equal(definition.separationRules.baselineSpecificThresholdTuningAllowed, false);
  assert.equal(definition.separationRules.sameCohortRequiredAcrossBaselines, true);
});

test("metric contract never grants product or betting authority", () => {
  const definition = buildN2MetricsDefinition();
  assert.deepEqual(definition.authority, {
    automaticPromotionAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    databaseWriteAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
  });
  assert.match(definition.outputDigest, /^[0-9a-f]{64}$/u);
  assert.equal(buildN2MetricsDefinition().outputDigest, definition.outputDigest);
});
