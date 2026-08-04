import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_SCHEMA_VERSION, QUEUE_STATE_SCHEMA_VERSION, computeStateDigest, dispatchableTasks,
  mergeCatalogAndState, resolveTask, validateCatalog, validateQueueState,
  type QueueState, type TaskCatalog,
} from "./taskCatalog";

function def(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "TASK-N2-001", taskDefinitionVersion: 1, title: "t", objective: "o",
    taskType: "dataset-canary", executor: "dataset-canary", safetyLevel: "L2",
    dependencies: [], maxDurationSeconds: 3600, expectedInputs: [], expectedOutputs: ["reports/n2/x.json"],
    estimatedDurationSeconds: 120, defaultStatus: "READY", valueOfInformation: "v", invalidationCondition: "i", ...over,
  };
}
function catalog(tasks: Record<string, unknown>[]): TaskCatalog {
  return { catalogSchemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion: "v1", updatedAt: "2026-08-04T00:00:00Z", tasks } as unknown as TaskCatalog;
}
function state(tasks: Record<string, unknown>): QueueState {
  return { stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION, stateVersion: 1, catalogVersion: "v1", updatedAt: "2026-08-04T00:00:00Z", tasks } as unknown as QueueState;
}

test("valid catalog passes", () => {
  const r = validateCatalog(catalog([def(), def({ taskId: "TASK-N2-002", dependencies: ["TASK-N2-001"] })]));
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test("catalog rejects duplicate ids, unknown dependency, bad safety, bad defaultStatus", () => {
  assert.ok(validateCatalog(catalog([def(), def()])).errors.some((e) => e.includes("duplicate")));
  assert.ok(validateCatalog(catalog([def({ dependencies: ["TASK-GHOST"] })])).errors.some((e) => e.includes("unknown")));
  assert.ok(validateCatalog(catalog([def({ safetyLevel: "L9" })])).errors.some((e) => e.includes("safetyLevel")));
  assert.ok(validateCatalog(catalog([def({ defaultStatus: "GO" })])).errors.some((e) => e.includes("defaultStatus")));
});

test("queue state validation", () => {
  assert.equal(validateQueueState(state({ "TASK-N2-001": { status: "PASS", taskDefinitionVersion: 1, attemptCount: 1 } })).valid, true);
  assert.equal(validateQueueState(state({ "TASK-N2-001": { status: "WAT", taskDefinitionVersion: 1, attemptCount: 1 } })).valid, false);
});

test("merge: state-less task falls back to defaultStatus; stale definition flagged", () => {
  const cat = catalog([def({ taskDefinitionVersion: 2 }), def({ taskId: "TASK-X", defaultStatus: "BLOCKED_EXECUTOR_PENDING" })]);
  const st = state({ "TASK-N2-001": { status: "PASS", taskDefinitionVersion: 1, attemptCount: 1 } });
  const merged = mergeCatalogAndState(cat, st);
  const t1 = merged.find((t) => t.taskId === "TASK-N2-001")!;
  const tx = merged.find((t) => t.taskId === "TASK-X")!;
  assert.equal(t1.status, "PASS");
  assert.equal(t1.staleDefinition, true); // state def v1 < catalog def v2
  assert.equal(tx.status, "BLOCKED_EXECUTOR_PENDING"); // no state → defaultStatus
});

test("dispatchable requires READY + all deps PASS + not stale", () => {
  const cat = validateCatalog(catalog([
    def({ taskId: "TASK-A", defaultStatus: "READY" }),
    def({ taskId: "TASK-B", dependencies: ["TASK-A"], defaultStatus: "READY" }),
  ])).catalog!;
  // A READY, B READY but dep A not PASS → only A dispatchable
  const st1 = state({ "TASK-A": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0 }, "TASK-B": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0 } });
  const d1 = dispatchableTasks(mergeCatalogAndState(cat, st1)).map((t) => t.taskId);
  assert.deepEqual(d1, ["TASK-A"]);
  // A PASS → B dispatchable
  const st2 = state({ "TASK-A": { status: "PASS", taskDefinitionVersion: 1, attemptCount: 1 }, "TASK-B": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0 } });
  const d2 = dispatchableTasks(mergeCatalogAndState(cat, st2)).map((t) => t.taskId);
  assert.deepEqual(d2, ["TASK-B"]);
});

test("resolveTask NEXT picks earliest-dispatchable; missing id reported", () => {
  const cat = validateCatalog(catalog([
    def({ taskId: "TASK-A", defaultStatus: "READY", estimatedDurationSeconds: 300 }),
    def({ taskId: "TASK-B", defaultStatus: "READY", estimatedDurationSeconds: 60 }),
  ])).catalog!;
  const st = state({ "TASK-A": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0 }, "TASK-B": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0 } });
  const merged = mergeCatalogAndState(cat, st);
  assert.equal(resolveTask(merged, "NEXT").task?.taskId, "TASK-B"); // shorter estimate first
  assert.equal(resolveTask(merged, "TASK-GHOST").task, null);
});

test("state digest is deterministic and status-sensitive", () => {
  const a = state({ "TASK-A": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0, resultDigest: null } });
  const b = state({ "TASK-A": { status: "READY", taskDefinitionVersion: 1, attemptCount: 0, resultDigest: null } });
  const c = state({ "TASK-A": { status: "PASS", taskDefinitionVersion: 1, attemptCount: 1, resultDigest: "x" } });
  assert.equal(computeStateDigest(a), computeStateDigest(b));
  assert.notEqual(computeStateDigest(a), computeStateDigest(c));
});
