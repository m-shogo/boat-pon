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
function catalog(tasks: Record<string, unknown>[], version = "v1"): TaskCatalog {
  return { catalogSchemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion: version, updatedAt: "2026-08-04T00:00:00Z", tasks } as unknown as TaskCatalog;
}
function state(tasks: Record<string, unknown>): QueueState {
  return { stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION, stateVersion: 1, catalogVersion: "v1", updatedAt: "2026-08-04T00:00:00Z", tasks } as unknown as QueueState;
}
function completeTask(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status,
    taskDefinitionVersion: 1,
    authoritySha: null,
    attemptCount: 0,
    maxAttempts: 3,
    evidenceLinks: [],
    resultDigest: null,
    lastFailure: null,
    checkpoint: null,
    updatedAt: "2026-08-04T00:00:00Z",
    ...overrides,
  };
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
  assert.equal(validateQueueState(state({ "TASK-N2-001": completeTask("PASS", { attemptCount: 1 }) })).valid, true);
  assert.equal(validateQueueState(state({ "TASK-N2-001": completeTask("WAT", { attemptCount: 1 }) })).valid, false);
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

// ---- catalog-state reconciliation（TASK-N2-010 の "state entry not found" 修正）----
import { reconcileCatalogState } from "./taskCatalog";

function reconState(): QueueState {
  // 実障害の再現: N2-001..006 PASS + PLANNER-NEXT、旧 catalogVersion、N2-010 以降 state 無し。
  const st = (status: string, over: Record<string, unknown> = {}) => ({
    status, taskDefinitionVersion: 1, authoritySha: "abc1234", attemptCount: 1, maxAttempts: 3,
    evidenceLinks: ["reports/automation/history/x.json"], resultDigest: "d1", lastFailure: null, checkpoint: null, updatedAt: "2026-08-04T00:00:00Z", ...over,
  });
  return {
    stateSchemaVersion: QUEUE_STATE_SCHEMA_VERSION, stateVersion: 18, catalogVersion: "2026-08-04-n2-foundation-v1", updatedAt: "2026-08-04T00:00:00Z",
    tasks: {
      "TASK-N2-001": st("PASS"), "TASK-N2-002": st("PASS"), "TASK-N2-003": st("PASS"),
      "TASK-N2-004": st("PASS"), "TASK-N2-005": st("PASS"), "TASK-N2-006": st("PASS"),
      "TASK-PLANNER-NEXT": st("READY", { attemptCount: 5 }),
    },
  } as unknown as QueueState;
}
function reconCatalog(): TaskCatalog {
  return validateCatalog(catalog([
    def({ taskId: "TASK-N2-001", defaultStatus: "READY" }), def({ taskId: "TASK-N2-002", defaultStatus: "READY" }),
    def({ taskId: "TASK-N2-003", defaultStatus: "READY" }), def({ taskId: "TASK-N2-004", defaultStatus: "READY" }),
    def({ taskId: "TASK-N2-005", defaultStatus: "READY" }), def({ taskId: "TASK-N2-006", defaultStatus: "READY" }),
    def({ taskId: "TASK-PLANNER-NEXT", defaultStatus: "READY" }),
    def({ taskId: "TASK-N2-010", taskDefinitionVersion: 2, defaultStatus: "READY", dependencies: ["TASK-N2-004"] }),
    def({ taskId: "TASK-N2-011", defaultStatus: "BLOCKED_EXECUTOR_PENDING" }),
    def({ taskId: "TASK-N2-020", defaultStatus: "BLOCKED_EXECUTOR_PENDING" }),
  ], "2026-08-05-n2-governance-v2")).catalog!;
}

test("reconcile: adds missing catalog tasks, preserves existing PASS + fields, bumps stateVersion once", () => {
  const r = reconcileCatalogState(reconCatalog(), reconState(), { now: "2026-08-05T00:00:00Z" });
  assert.equal(r.changed, true);
  const s = r.nextState;
  // #2/#3/#4/#5/#6: N2-001..006 PASS + fields 不変
  for (const id of ["TASK-N2-001", "TASK-N2-006"]) {
    assert.equal(s.tasks[id].status, "PASS");
    assert.equal(s.tasks[id].attemptCount, 1);
    assert.deepEqual(s.tasks[id].evidenceLinks, ["reports/automation/history/x.json"]);
    assert.equal(s.tasks[id].resultDigest, "d1");
  }
  assert.equal(s.tasks["TASK-PLANNER-NEXT"].attemptCount, 5); // 既存維持
  // #7: N2-010 version2 READY 追加
  assert.equal(s.tasks["TASK-N2-010"].status, "READY");
  assert.equal(s.tasks["TASK-N2-010"].taskDefinitionVersion, 2);
  assert.equal(s.tasks["TASK-N2-010"].attemptCount, 0);
  assert.equal(s.tasks["TASK-N2-010"].resultDigest, null);
  // #8: N2-011/020 BLOCKED_EXECUTOR_PENDING 追加
  assert.equal(s.tasks["TASK-N2-011"].status, "BLOCKED_EXECUTOR_PENDING");
  assert.equal(s.tasks["TASK-N2-020"].status, "BLOCKED_EXECUTOR_PENDING");
  // #9 catalogVersion 更新 / #10 stateVersion +1
  assert.equal(s.catalogVersion, "2026-08-05-n2-governance-v2");
  assert.equal(s.stateVersion, 19);
  assert.deepEqual(r.plan.added.map((a) => a.taskId), ["TASK-N2-010", "TASK-N2-011", "TASK-N2-020"]);
});

test("reconcile: re-run is NO_CHANGE (no stateVersion bump, identical state)", () => {
  const first = reconcileCatalogState(reconCatalog(), reconState(), { now: "2026-08-05T00:00:00Z" });
  const second = reconcileCatalogState(reconCatalog(), first.nextState, { now: "2026-08-05T01:00:00Z" });
  assert.equal(second.changed, false); // #11
  assert.equal(second.nextState.stateVersion, 19); // #12 不変
  assert.equal(second.nextState, first.nextState); // 同一 object を返す（#13 commit 判定に使う）
  assert.deepEqual(second.plan.added, []);
});

test("reconcile: dispatchable after reconcile = N2-010 (+PLANNER); N2-011+ not dispatchable (#24/#25)", () => {
  const r = reconcileCatalogState(reconCatalog(), reconState(), { now: "t" });
  const merged = mergeCatalogAndState(reconCatalog(), r.nextState);
  const d = dispatchableTasks(merged).map((t) => t.taskId).sort();
  assert.deepEqual(d, ["TASK-N2-010", "TASK-PLANNER-NEXT"]);
  const n011 = merged.find((t) => t.taskId === "TASK-N2-011")!;
  assert.equal(n011.status, "BLOCKED_EXECUTOR_PENDING");
});

test("reconcile: never reverts PASS to READY even if catalog defaultStatus=READY (#stale-safe)", () => {
  const r = reconcileCatalogState(reconCatalog(), reconState(), { now: "t" });
  for (const id of ["TASK-N2-001", "TASK-N2-002", "TASK-N2-003", "TASK-N2-004", "TASK-N2-005", "TASK-N2-006"]) {
    assert.equal(r.nextState.tasks[id].status, "PASS");
  }
});

test("reconcile: orphan task (in state, not in catalog) is kept + flagged, never deleted (#20)", () => {
  const state = reconState();
  (state.tasks as any)["TASK-GONE"] = { status: "PASS", taskDefinitionVersion: 1, authoritySha: null, attemptCount: 1, maxAttempts: 3, evidenceLinks: [], resultDigest: null, lastFailure: null, checkpoint: null, updatedAt: "t" };
  const r = reconcileCatalogState(reconCatalog(), state, { now: "t" });
  assert.ok(r.plan.orphaned.includes("TASK-GONE"));
  assert.ok("TASK-GONE" in r.nextState.tasks); // 残す
});

test("reconcile: stale definition (state defVersion < catalog) diagnosed, not auto-READY (#19)", () => {
  const state = reconState();
  (state.tasks as any)["TASK-N2-004"].taskDefinitionVersion = 1; // catalog is also 1 here → make catalog 2
  const cat = validateCatalog(catalog([
    def({ taskId: "TASK-N2-004", taskDefinitionVersion: 2, defaultStatus: "READY" }),
  ], "2026-08-05-n2-governance-v2")).catalog!;
  const partialState = { ...state, tasks: { "TASK-N2-004": (state.tasks as any)["TASK-N2-004"] } } as QueueState;
  const r = reconcileCatalogState(cat, partialState, { now: "t" });
  assert.ok(r.plan.staleDefinition.some((s) => s.taskId === "TASK-N2-004"));
  assert.equal(r.nextState.tasks["TASK-N2-004"].status, "PASS"); // 自動で READY へ戻さない
});

test("reconcile: catalogVersion-only change bumps stateVersion once then NO_CHANGE", () => {
  // 同じ tasks, catalogVersion だけ違う → 1 回だけ前進、再実行で NO_CHANGE
  const cat = reconCatalog();
  const state = reconState();
  const full = reconcileCatalogState(cat, state, { now: "t1" }); // adds tasks + version
  const again = reconcileCatalogState(cat, full.nextState, { now: "t2" });
  assert.equal(again.changed, false);
});
