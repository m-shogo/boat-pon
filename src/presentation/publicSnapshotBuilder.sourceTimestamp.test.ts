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

test("builder ignores date-only source timestamps instead of emitting invalid public timestamps", () => {
  const snapshot = buildPublicDashboardSnapshot({
    ...baseInput,
    queueState: { updatedAt: "2026-08-10" },
    currentRun: { updatedAt: "2026-08-10" },
    readiness: { evaluatedAt: "2026-08-10" },
  });

  assert.equal(snapshot.dataAsOf, baseInput.generatedAt);
  assert.equal(snapshot.status.lastRunAt, null);
});

test("builder retains timezone-qualified source timestamps", () => {
  const snapshot = buildPublicDashboardSnapshot({
    ...baseInput,
    queueState: { updatedAt: "2026-08-10T20:00:00Z" },
    currentRun: { updatedAt: "2026-08-10T21:00:00Z" },
    readiness: { evaluatedAt: "2026-08-10T22:00:00Z" },
  });

  assert.equal(snapshot.dataAsOf, "2026-08-10T22:00:00Z");
  assert.equal(snapshot.status.lastRunAt, "2026-08-10T21:00:00Z");
});
