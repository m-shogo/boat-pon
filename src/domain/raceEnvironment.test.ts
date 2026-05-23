import assert from "node:assert/strict";
import test from "node:test";
import { assessEnvironmentRisk } from "./raceEnvironment";

test("風波や安定板を環境リスクとして評価する", () => {
  assert.equal(assessEnvironmentRisk({ windSpeedMps: 9 }).level, "medium");
  const high = assessEnvironmentRisk({ windSpeedMps: 9, stablePlate: true });
  assert.equal(high.level, "high");
  assert.ok(high.reasons.includes("安定板使用"));
});
