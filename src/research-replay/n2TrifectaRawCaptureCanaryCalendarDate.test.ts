import assert from "node:assert/strict";
import test from "node:test";

import {
  buildN2TrifectaRawCapturePlan,
  parseBoatRaceDisplayedOddsUpdateTime,
} from "./n2TrifectaRawCaptureCanary.js";

test("raw capture plan rejects impossible Gregorian race dates", () => {
  const plan = buildN2TrifectaRawCapturePlan([{
    date: "2026-02-30",
    venueCode: "05",
    raceNo: 1,
    closeAt: "10:05",
  }]);

  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.structuralBlockers.includes("INVALID_RACE_DATE"));
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.raceCount, 0);
  assert.equal(plan.requestBudget, 0);
});

test("raw capture plan preserves valid leap-day race dates", () => {
  const plan = buildN2TrifectaRawCapturePlan([{
    date: "2028-02-29",
    venueCode: "05",
    raceNo: 1,
    closeAt: "10:05",
  }]);

  assert.equal(plan.status, "REVIEW_BUNDLE_READY_NOT_AUTHORIZED");
  assert.deepEqual(plan.structuralBlockers, []);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0]?.date, "2028-02-29");
  assert.equal(plan.entries[0]?.decisionCutoff, "2028-02-29T01:05:00.000Z");
});

test("displayed odds update parser rejects impossible race dates before normalization", () => {
  const result = parseBoatRaceDisplayedOddsUpdateTime(
    "<html><body>オッズ更新時間：09:35</body></html>",
    "2026-02-30",
  );

  assert.deepEqual(result, {
    status: "INVALID_RACE_DATE",
    displayedTimes: [],
    availableAt: null,
  });
});
