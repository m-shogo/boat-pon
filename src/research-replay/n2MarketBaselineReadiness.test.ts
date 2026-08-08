import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_MARKET_BASELINE_MIN_SETTLED_RACES,
  buildN2MarketBaselineReadinessReport,
} from "./n2MarketBaselineReadiness";

function race(index: number, date = "2026-08-07"): string {
  return `${date}:10:R${index}`;
}

test("market baseline readiness starts with no private data", () => {
  const report = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: [],
    settledRaceKeys: [],
  });
  assert.equal(report.status, "NO_PRIVATE_MARKET_DATA");
  assert.equal(report.n2TaskReady, false);
  assert.equal(report.minimumSettledRaceCount, 20);
});

test("accepted T-5 evidence waits for settlement instead of consuming N2-020", () => {
  const report = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: [race(1), race(2)],
    settledRaceKeys: [],
  });
  assert.equal(report.status, "WAITING_FOR_SETTLEMENT");
  assert.equal(report.acceptedT5RaceCount, 2);
  assert.equal(report.settledAcceptedT5RaceCount, 0);
  assert.equal(report.unsettledAcceptedT5RaceCount, 2);
  assert.equal(report.n2TaskReady, false);
});

test("readiness accumulates clean settled races until the fixed minimum", () => {
  const accepted = [
    ...Array.from({ length: 12 }, (_, index) => race(index + 1, "2026-08-07")),
    ...Array.from({ length: 8 }, (_, index) => race(index + 1, "2026-08-08")),
  ];
  const before = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: accepted,
    settledRaceKeys: accepted.slice(0, N2_MARKET_BASELINE_MIN_SETTLED_RACES - 1),
  });
  assert.equal(before.status, "ACCUMULATING");
  assert.equal(before.n2TaskReady, false);

  const ready = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: accepted,
    settledRaceKeys: accepted,
  });
  assert.equal(ready.status, "READY_FOR_N2_020");
  assert.equal(ready.settledAcceptedT5RaceCount, 20);
  assert.equal(ready.distinctSettledDateCount, 2);
  assert.equal(ready.n2TaskReady, true);
});

test("duplicates do not inflate readiness and unrelated settlement rows are ignored", () => {
  const report = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: [race(1), race(1)],
    settledRaceKeys: [race(1), race(1), race(2)],
    minimumSettledRaceCount: 1,
  });
  assert.equal(report.acceptedT5RaceCount, 1);
  assert.equal(report.settledAcceptedT5RaceCount, 1);
  assert.equal(report.status, "READY_FOR_N2_020");
});

test("private integrity blockers fail closed even with enough settled races", () => {
  const accepted = [
    ...Array.from({ length: 12 }, (_, index) => race(index + 1, "2026-08-07")),
    ...Array.from({ length: 8 }, (_, index) => race(index + 1, "2026-08-08")),
  ];
  const report = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: accepted,
    settledRaceKeys: accepted,
    integrityBlockedRaceKeys: [race(3)],
  });
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.n2TaskReady, false);
  assert.equal(report.integrityBlockedRaceCount, 1);
});

test("protected product authorities remain false", () => {
  const report = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: [],
    settledRaceKeys: [],
  });
  assert.equal(report.automaticPromotionAuthorized, false);
  assert.equal(report.currentBuyConnectionAuthorized, false);
  assert.equal(report.lineConnectionAuthorized, false);
  assert.equal(report.publicPublishAuthorized, false);
  assert.equal(report.databaseWriteAuthorized, false);
  assert.equal(report.automatedBettingAuthorized, false);
  assert.equal(report.productionApplyAuthorized, false);
});
