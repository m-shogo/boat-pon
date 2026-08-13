import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalN2EvaluationRaceKey } from "./n2EvaluationMetricsSettlementReader";

test("evaluation race key calendar validation", () => {
  assert.equal(isCanonicalN2EvaluationRaceKey("2026-02-30:05:R1"), false);
  assert.equal(isCanonicalN2EvaluationRaceKey("2028-02-29:05:R1"), true);
});
