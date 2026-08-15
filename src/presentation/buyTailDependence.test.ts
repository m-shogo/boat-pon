import assert from "node:assert/strict";
import test from "node:test";
import { assessBuyTailDependence } from "./buyTailDependence";

const stableTail = { settled: 30, hits: 1, payoutOddsSum: 60, maxPayoutOdds: 60 };
const diversified = { settled: 30, hits: 6, payoutOddsSum: 36, maxPayoutOdds: 6 };

test("requires two complete independent windows before judging tail stability", () => {
  const assessment = assessBuyTailDependence(
    stableTail,
    { settled: 28, hits: 1, payoutOddsSum: 50, maxPayoutOdds: 50 },
  );
  assert.equal(assessment.status, "INSUFFICIENT_SUPPORT");
  assert.equal(assessment.missingSettledToCompare, 2);
  assert.equal(assessment.recent.tailDependent, true);
  assert.equal(assessment.prior.tailDependent, false);
  assert.equal(assessment.productionChangeAllowed, false);
});

test("detects max-hit dependence only when it repeats in both independent windows", () => {
  const assessment = assessBuyTailDependence(stableTail, stableTail);
  assert.equal(assessment.status, "PERSISTENT_TAIL_DEPENDENCE");
  assert.equal(assessment.recent.roi, 2);
  assert.equal(assessment.recent.roiExMax, 0);
  assert.equal(assessment.recent.tailGap, 2);
  assert.equal(assessment.prior.tailGap, 2);
});

test("separates recent-only and prior-only tail regimes", () => {
  assert.equal(assessBuyTailDependence(stableTail, diversified).status, "RECENT_TAIL_DEPENDENCE");
  assert.equal(assessBuyTailDependence(diversified, stableTail).status, "PRIOR_TAIL_DEPENDENCE");
  assert.equal(assessBuyTailDependence(diversified, diversified).status, "NO_TAIL_DEPENDENCE_SIGNAL");
});

test("rejects inconsistent or oversized window aggregates", () => {
  assert.throws(() => assessBuyTailDependence(
    { settled: 31, hits: 1, payoutOddsSum: 2, maxPayoutOdds: 2 },
    diversified,
  ), /invalid BUY tail window aggregate/);
  assert.throws(() => assessBuyTailDependence(
    { settled: 30, hits: 1, payoutOddsSum: 2, maxPayoutOdds: 3 },
    diversified,
  ), /invalid BUY tail window aggregate/);
});
