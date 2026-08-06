import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_TRIFECTA_RAW_CAPTURE_POLICY,
  N2_TRIFECTA_SITE_POLICY_REVIEW,
  buildN2TrifectaRawCapturePlan,
  parseBoatRaceDisplayedOddsUpdateTime,
} from "./n2TrifectaRawCaptureCanary.js";

test("site-policy review keeps raw capture private and high-frequency/public use blocked", () => {
  assert.equal(
    N2_TRIFECTA_SITE_POLICY_REVIEW.status,
    "REVIEWED_RESTRICTIVE_PRIVATE_RESEARCH_BOUNDARY",
  );
  assert.equal(N2_TRIFECTA_SITE_POLICY_REVIEW.privateResearchCandidate, true);
  assert.equal(N2_TRIFECTA_SITE_POLICY_REVIEW.highFrequencyAutomationAuthorized, false);
  assert.equal(N2_TRIFECTA_SITE_POLICY_REVIEW.publicReuseAuthorized, false);
  assert.equal(N2_TRIFECTA_SITE_POLICY_REVIEW.redistributionAuthorized, false);
  assert.equal(N2_TRIFECTA_SITE_POLICY_REVIEW.commercialReuseAuthorized, false);

  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.concurrency, 1);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.maxAttemptsPerRequest, 1);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.networkExecutionAuthorized, false);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.databaseWriteAuthorized, false);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.gitCommitRawAuthorized, false);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.publicPublishAuthorized, false);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.currentBuyConnectionAuthorized, false);
  assert.equal(N2_TRIFECTA_RAW_CAPTURE_POLICY.lineConnectionAuthorized, false);
});

test("T-10 raw review plan is one venue-day, bounded and not authorized", () => {
  const plan = buildN2TrifectaRawCapturePlan([
    { date: "2026-08-06", venueCode: "05", raceNo: 1, closeAt: "10:05" },
    { date: "2026-08-06", venueCode: "05", raceNo: 2, closeAt: "10:35" },
  ]);
  assert.equal(plan.status, "REVIEW_BUNDLE_READY_NOT_AUTHORIZED");
  assert.deepEqual(plan.structuralBlockers, []);
  assert.equal(plan.raceCount, 2);
  assert.equal(plan.requestBudget, 2);
  assert.equal(plan.entries.length, 2);
  assert.ok(plan.entries.every((entry) => entry.checkpointLabel === "T-10"));
  assert.equal(plan.networkExecutionAuthorized, false);
  assert.equal(plan.rawPersistenceAuthorized, false);
  assert.equal(plan.databaseWriteAuthorized, false);
  assert.equal(plan.approvalCreated, false);
  assert.equal(plan.productionApplyExecuted, false);
});

test("T-10 raw review blocks accidental multi-venue collection", () => {
  const plan = buildN2TrifectaRawCapturePlan([
    { date: "2026-08-06", venueCode: "05", raceNo: 1, closeAt: "10:05" },
    { date: "2026-08-06", venueCode: "12", raceNo: 1, closeAt: "10:10" },
  ]);
  assert.equal(plan.status, "BLOCKED");
  assert.deepEqual(plan.entries, []);
  assert.ok(plan.structuralBlockers.includes("ONE_VENUE_DAY_ONLY"));
});

test("displayed odds update time is converted from JST and ambiguity fails closed", () => {
  const passed = parseBoatRaceDisplayedOddsUpdateTime(
    "<html><body><p>オッズ更新時間：10:03</p></body></html>",
    "2026-08-06",
  );
  assert.deepEqual(passed, {
    status: "PASS",
    displayedTimes: ["10:03"],
    availableAt: "2026-08-06T01:03:00.000Z",
  });

  const ambiguous = parseBoatRaceDisplayedOddsUpdateTime(
    "<html><body>オッズ更新時間 10:03 オッズ更新時刻 10:04</body></html>",
    "2026-08-06",
  );
  assert.equal(ambiguous.status, "AMBIGUOUS");
  assert.equal(ambiguous.availableAt, null);
  assert.deepEqual(ambiguous.displayedTimes, ["10:03", "10:04"]);

  const missing = parseBoatRaceDisplayedOddsUpdateTime(
    "<html><body>更新時刻の表示なし</body></html>",
    "2026-08-06",
  );
  assert.equal(missing.status, "MISSING");
  assert.equal(missing.availableAt, null);
});
