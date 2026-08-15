import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyLearningSummary } from "./buyLearningSummary";
import { buildOwnerDashboardSnapshot } from "./ownerDashboardBuilder";
import { validateOwnerDashboardSnapshot } from "./ownerDashboardSnapshot";

const base = {
  generatedAt: "2026-08-15T07:00:00Z",
  canonicalBranch: "main",
  mainSha: "1309548646cfbdcf43af1fcfad0985021f1d1a48",
  ciStatus: "PASS" as const,
  openPrCount: 0,
  gitCleanliness: "CLEAN" as const,
  gitUpdatedAt: "2026-08-15T06:58:00Z",
  taskCatalog: { tasks: [] },
  queueState: { tasks: {} },
  currentRun: { updatedAt: "2026-08-15T06:59:00Z", lastResult: "PASS", blocks: [] },
};

test("owner dashboard surfaces actionable BUY learning without granting production change", () => {
  const buyLearning = buildBuyLearningSummary({
    generatedAt: "2026-08-15T06:59:30Z",
    totalDecisions: 40,
    settled: 40,
    hits: 5,
    payoutOddsSum: 25,
    maxPayoutOdds: 10,
    avgEstimatedHitRate: 0.30,
    recentSettled: 20,
    recentHits: 2,
    recentPayoutOddsSum: 8,
    smallSampleMisses: 4,
    highConfidenceMisses: 2,
    highEvMisses: 3,
  });
  const snapshot = buildOwnerDashboardSnapshot({ ...base, buyLearning });
  assert.equal(snapshot.buyLearning.status, "AVAILABLE");
  assert.equal(snapshot.overall.status, "ATTENTION");
  assert.match(snapshot.nextSafeAction ?? "", /RESEARCH-/);
  assert.ok(snapshot.buyLearning.researchCandidates.every((item) => item.productionChangeAllowed === false));
  assert.deepEqual(validateOwnerDashboardSnapshot(snapshot), []);
});

test("malformed BUY learning input degrades to NOT_AVAILABLE instead of leaking or guessing", () => {
  const snapshot = buildOwnerDashboardSnapshot({ ...base, buyLearning: { schemaVersion: "bad", selection: "1-2-3" } });
  assert.equal(snapshot.buyLearning.status, "NOT_AVAILABLE");
  assert.equal(snapshot.buyLearning.performance.settled, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /1-2-3|selection/);
  assert.deepEqual(validateOwnerDashboardSnapshot(snapshot), []);
});
