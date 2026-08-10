import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicDashboardSnapshot } from "./publicSnapshotBuilder";

const baseInput = {
  catalog: { tasks: [] },
  queueState: {},
  currentRun: {},
  readiness: {},
  generatedAt: "2026-08-11T00:00:00Z",
  modelVersion: "model-v1",
};

test("builder rejects date-only generatedAt before producing an invalid snapshot", () => {
  assert.throws(
    () => buildPublicDashboardSnapshot({ ...baseInput, generatedAt: "2026-08-11" }),
    /generatedAt must be an RFC3339 date-time/,
  );
});

test("builder rejects modelVersion longer than the public snapshot schema bound", () => {
  assert.throws(
    () => buildPublicDashboardSnapshot({ ...baseInput, modelVersion: "m".repeat(121) }),
    /modelVersion must have length 1\.\.120/,
  );
});

test("builder accepts the schema boundary modelVersion length", () => {
  const snapshot = buildPublicDashboardSnapshot({ ...baseInput, modelVersion: "m".repeat(120) });
  assert.equal(snapshot.modelVersion.length, 120);
});

test("builder rejects catalog output beyond the public pipeline item bound", () => {
  const tasks = Array.from({ length: 201 }, (_, index) => ({
    taskId: `TASK-${index}`,
    title: `Task ${index}`,
    dependencies: [],
  }));

  assert.throws(
    () => buildPublicDashboardSnapshot({ ...baseInput, catalog: { tasks } }),
    /public snapshot builder produced invalid output: .*pipeline: max 200 items/,
  );
});

test("builder rejects catalog dependencies beyond the public pipeline dependency bound", () => {
  const dependencies = Array.from({ length: 51 }, (_, index) => `TASK-DEP-${index}`);

  assert.throws(
    () => buildPublicDashboardSnapshot({
      ...baseInput,
      catalog: {
        tasks: [{ taskId: "TASK-ROOT", title: "Root", dependencies }],
      },
    }),
    /public snapshot builder produced invalid output: .*dependencies: max 50 items/,
  );
});