import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_SCHEMA_VERSION, validateCatalog, type TaskCatalog } from "./taskCatalog";

function task(taskId: string, dependencies: string[] = []): Record<string, unknown> {
  return {
    taskId,
    taskDefinitionVersion: 1,
    title: taskId,
    objective: "o",
    taskType: "readonly-audit",
    executor: "readonly-audit",
    safetyLevel: "L0",
    dependencies,
    maxDurationSeconds: 3600,
    expectedInputs: [],
    expectedOutputs: [],
    estimatedDurationSeconds: 60,
    defaultStatus: "READY",
    valueOfInformation: "v",
    invalidationCondition: "i",
  };
}

function catalog(tasks: Record<string, unknown>[]): TaskCatalog {
  return {
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: "v1",
    updatedAt: "2026-08-10T00:00:00Z",
    tasks,
  } as unknown as TaskCatalog;
}

test("catalog accepts an acyclic dependency graph", () => {
  const result = validateCatalog(catalog([
    task("TASK-A"),
    task("TASK-B", ["TASK-A"]),
    task("TASK-C", ["TASK-B"]),
  ]));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("catalog rejects self dependency", () => {
  const result = validateCatalog(catalog([task("TASK-A", ["TASK-A"])]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("dependency cycle: TASK-A -> TASK-A")));
});

test("catalog rejects multi-task dependency cycle", () => {
  const result = validateCatalog(catalog([
    task("TASK-A", ["TASK-C"]),
    task("TASK-B", ["TASK-A"]),
    task("TASK-C", ["TASK-B"]),
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("dependency cycle:")));
});
