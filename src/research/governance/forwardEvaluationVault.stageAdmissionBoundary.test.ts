import assert from "node:assert/strict";
import test from "node:test";
import { canPoolStages, type EvidenceStage } from "./forwardEvaluationVault";

test("valid same-stage pooling and stage separation remain unchanged", () => {
  assert.equal(canPoolStages(["SHADOW_FORWARD", "SHADOW_FORWARD"]), true);
  assert.equal(canPoolStages(["SHADOW_FORWARD", "FUTURE_ONLY"]), false);
  // Empty means no stages were pooled; preserve the previous vacuous behavior.
  assert.equal(canPoolStages([]), true);
});
test("unknown singleton stage does not become a valid pool", () => {
  assert.equal(canPoolStages(["UNKNOWN" as EvidenceStage]), false);
  assert.equal(canPoolStages(["HISTORICAL", "UNKNOWN" as EvidenceStage]), false);
});
test("undefined and non-array stage inputs fail closed", () => {
  assert.equal(canPoolStages([undefined as unknown as EvidenceStage]), false);
  assert.equal(canPoolStages(null as unknown as EvidenceStage[]), false);
});
test("sparse stage arrays fail closed", () => {
  assert.equal(canPoolStages(new Array(1) as EvidenceStage[]), false);
});
test("accessor arrays are rejected without invoking the getter", () => {
  const stages = ["SHADOW_FORWARD"] as EvidenceStage[];
  let reads = 0;
  Object.defineProperty(stages, "0", { enumerable: true, get() { reads++; throw new Error("untrusted getter"); } });
  assert.equal(canPoolStages(stages), false);
  assert.equal(reads, 0);
});
