import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { validatePublicSnapshotForPublication } from "./publicSnapshotPublisher";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

test("publication rejects a candidate that would roll latest behind a newer valid snapshot", async () => {
  const existingLatest = await snapshotAt("2026-08-11T09:00:00.000Z");
  const existingLastKnownGood = await snapshotAt("2026-08-11T08:00:00.000Z");
  const candidate = await snapshotAt("2026-08-11T08:30:00.000Z");

  const result = await validatePublicSnapshotForPublication({
    candidate,
    existingLatest,
    existingLastKnownGood,
    nowMs: Date.parse("2026-08-11T09:01:00.000Z"),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["CANDIDATE_ROLLBACK_LATEST_DATA_AS_OF"]);
  assert.equal(result.snapshot, null);
});

test("publication accepts a candidate newer than both latest and last-known-good", async () => {
  const existingLatest = await snapshotAt("2026-08-11T09:00:00.000Z");
  const existingLastKnownGood = await snapshotAt("2026-08-11T08:00:00.000Z");
  const candidate = await snapshotAt("2026-08-11T09:01:00.000Z");

  const result = await validatePublicSnapshotForPublication({
    candidate,
    existingLatest,
    existingLastKnownGood,
    nowMs: Date.parse("2026-08-11T09:02:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot?.dataAsOf, "2026-08-11T09:01:00.000Z");
});

async function snapshotAt(timestamp: string): Promise<PublicDashboardSnapshot> {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.generatedAt = timestamp;
  snapshot.dataAsOf = timestamp;
  snapshot.status.lastRunAt = timestamp;
  snapshot.integrity.digest = "0".repeat(64);
  return sealPublicDashboardSnapshot(snapshot);
}
