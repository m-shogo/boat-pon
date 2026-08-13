import assert from "node:assert/strict";
import test from "node:test";
import { buildN2MarketBaselineReadinessReport } from "./n2MarketBaselineReadiness";

test("settlement-only invalid race key blocks readiness", () => {
  const report = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: ["2026-08-07:10:R1"],
    settledRaceKeys: ["2026-08-07:10:R1", "2026-02-30:10:R2"],
    minimumSettledRaceCount: 1,
  });
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.blockers, ["INVALID_CANONICAL_RACE_KEY:1"]);
  assert.equal(report.n2TaskReady, false);
});
