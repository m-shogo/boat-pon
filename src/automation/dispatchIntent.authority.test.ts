import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalRequest, type DispatchIntent } from "./dispatchIntent";
import type { MergedTask } from "./taskCatalog";

const task: MergedTask = {
  taskId: "TASK-N2-004",
  taskDefinitionVersion: 1,
  title: "t",
  objective: "o",
  taskType: "dataset-expand",
  executor: "dataset-expand",
  safetyLevel: "L0",
  dependencies: [],
  maxDurationSeconds: 3600,
  expectedInputs: [],
  expectedOutputs: ["reports/n2/n2-dataset-inventory.json"],
  estimatedDurationSeconds: 300,
  defaultStatus: "READY",
  valueOfInformation: "v",
  invalidationCondition: "i",
  status: "READY",
  state: null,
  staleDefinition: false,
};

const intent: DispatchIntent = {
  intentSchemaVersion: "research-dispatch-intent-v1",
  intentId: "INTENT-20260810-authority1",
  taskId: task.taskId,
  requestedAction: "run-task",
  safetyLevel: "L0",
  expectedAuthoritySha: "aa58a52",
  maxDurationSeconds: 1800,
  requestedBy: "test",
  requestReference: "test:authority-binding",
};

test("canonical request binds the intent to the expected authority SHA prefix", () => {
  const matching = buildCanonicalRequest({
    intent,
    authoritySha: "aa58a524e4569defbebff02717fd6befcb00fb9c",
    queueDigest: "a".repeat(64),
    createdAt: "2026-08-10T12:00:00.000Z",
    task,
  });
  assert.deepEqual(matching.errors, []);

  const stale = buildCanonicalRequest({
    intent,
    authoritySha: "bb58a524e4569defbebff02717fd6befcb00fb9c",
    queueDigest: "a".repeat(64),
    createdAt: "2026-08-10T12:00:00.000Z",
    task,
  });
  assert.ok(stale.errors.some((error) => error.includes("does not match authority")));
});
