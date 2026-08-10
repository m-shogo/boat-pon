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
