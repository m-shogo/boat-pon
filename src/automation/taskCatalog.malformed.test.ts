import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_SCHEMA_VERSION, validateCatalog } from "./taskCatalog";

function catalog(tasks: unknown[]) {
  return {
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: "v1",
    updatedAt: "2026-08-10T00:00:00Z",
    tasks,
  };
}

test("catalog rejects non-object task entries without throwing", () => {
  for (const malformed of [null, "TASK-A", [], 42]) {
    const result = validateCatalog(catalog([malformed]));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("tasks[0] must be an object")));
  }
});

test("catalog dependency validation remains fail-closed with malformed neighbors", () => {
  const result = validateCatalog(catalog([
    null,
    {
      taskId: "TASK-B",
      taskDefinitionVersion: 1,
      title: "TASK-B",
      objective: "o",
      taskType: "readonly-audit",
      executor: "readonly-audit",
      safetyLevel: "L0",
      dependencies: ["TASK-MISSING"],
      maxDurationSeconds: 3600,
      expectedInputs: [],
      expectedOutputs: [],
      estimatedDurationSeconds: 60,
      defaultStatus: "READY",
      valueOfInformation: "v",
      invalidationCondition: "i",
    },
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("tasks[0] must be an object")));
  assert.ok(result.errors.some((error) => error.includes("depends on unknown TASK-MISSING")));
});
