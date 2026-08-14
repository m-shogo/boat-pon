import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerDashboardSnapshot } from "./ownerDashboardBuilder";
import { validateOwnerDashboardSnapshot } from "./ownerDashboardSnapshot";

const catalog = { tasks: [{ taskId: "TASK-N2-011", title: "PIT再検証" }, { taskId: "TASK-N2-020", title: "feature engineering" }] };
const queueState = { tasks: {
  "TASK-N2-011": { status: "PASS", attemptCount: 3, maxAttempts: 3 },
  "TASK-N2-020": { status: "BLOCKED_EXECUTOR_PENDING", attemptCount: 0, maxAttempts: 3 },
} };
const base = {
  generatedAt: "2026-08-15T00:00:00.000Z",
  canonicalBranch: "main",
  mainSha: "70050f70d1a18df7329cc59aa0276797442fa5a3",
  ciStatus: "PASS" as const,
  openPrCount: 1,
  gitCleanliness: "CLEAN" as const,
  gitUpdatedAt: "2026-08-13T10:49:16.000Z",
  taskCatalog: catalog,
  queueState,
};

test("owner read model exposes only authority-backed attempt values", () => {
  const snapshot = buildOwnerDashboardSnapshot({ ...base,
    currentRun: { updatedAt: "2026-08-06T07:10:30.994Z", lastResult: "PASS", lastTaskId: "TASK-N2-011", taskStatus: "PASS", blocks: [], nextCandidate: "TASK-PLANNER-NEXT: 次候補提案（自動起動しない）" },
    recentCommits: [{ sha: "70050f70d1a18df", message: "fix(research): reject impossible supersession dates (#570)", committedAt: "2026-08-13T10:49:16.000Z" }],
  });
  assert.equal(snapshot.n2Tasks[0]?.attemptCount, 3);
  assert.equal(snapshot.n2Tasks[1]?.maxAttempts, 3);
  assert.equal(snapshot.overall.status, "ATTENTION");
  assert.match(snapshot.blockers[0] ?? "", /TASK-N2-020/);
  assert.equal(snapshot.hourlyResearch.lastRunAt, "2026-08-13T10:49:16.000Z");
  assert.equal(snapshot.hourlyResearch.lastResult, "MAIN UPDATED / CI PASS");
  assert.equal(validateOwnerDashboardSnapshot(snapshot).length, 0);
});

test("private run diagnostics do not leak into owner snapshot", () => {
  const snapshot = buildOwnerDashboardSnapshot({ ...base,
    currentRun: { updatedAt: "2026-08-06T07:10:30.994Z", lastResult: "PASS", lastTaskId: "TASK-N2-011", blocks: ["/Users/example/private.sqlite", "currentOdds=12.3", "safe public blocker"] },
  });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /Users\/example|currentOdds|private\.sqlite/);
  assert.match(serialized, /safe public blocker/);
});

test("malformed sources fail safe instead of inventing readiness", () => {
  const snapshot = buildOwnerDashboardSnapshot({ ...base,
    ciStatus: "NOT_AVAILABLE",
    gitCleanliness: "NOT_AVAILABLE",
    taskCatalog: null,
    queueState: { tasks: { "TASK-N2-999": { status: "READY" } } },
    currentRun: null,
  });
  assert.equal(snapshot.n2Tasks.length, 0);
  assert.equal(snapshot.overall.status, "ATTENTION");
  assert.equal(snapshot.hourlyResearch.lastResult, "NOT_AVAILABLE");
});

test("unknown fields are rejected by the public owner schema", () => {
  const snapshot = buildOwnerDashboardSnapshot({ ...base, currentRun: null });
  const mutated = structuredClone(snapshot) as unknown as Record<string, unknown>;
  mutated.privatePayload = { harmlessLooking: true };
  assert.match(validateOwnerDashboardSnapshot(mutated).join("\n"), /unknown key/);
});
