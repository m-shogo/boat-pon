import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { validatePublicSnapshotForPublication } from "./publicSnapshotPublisher";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

async function snapshotAt(generatedAt: string, dataAsOf: string): Promise<PublicDashboardSnapshot> {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.generatedAt = generatedAt;
  snapshot.dataAsOf = dataAsOf;
  snapshot.status.lastRunAt = dataAsOf;
  snapshot.status.snapshotFreshness = "FRESH";
  snapshot.integrity.digest = "0".repeat(64);
  return sealPublicDashboardSnapshot(snapshot);
}

test("publication rejects generatedAt rollback when dataAsOf is unchanged", async () => {
  const existing = await snapshotAt("2026-08-11T02:00:00Z", "2026-08-11T01:00:00Z");
  const olderGeneration = await snapshotAt("2026-08-11T01:30:00Z", "2026-08-11T01:00:00Z");

  const result = await validatePublicSnapshotForPublication({
    candidate: olderGeneration,
    existingLastKnownGood: existing,
    nowMs: Date.parse("2026-08-11T02:01:00Z"),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["CANDIDATE_ROLLBACK_GENERATED_AT"]);
});

test("publication allows a newer generation for unchanged dataAsOf", async () => {
  const existing = await snapshotAt("2026-08-11T01:30:00Z", "2026-08-11T01:00:00Z");
  const newerGeneration = await snapshotAt("2026-08-11T02:00:00Z", "2026-08-11T01:00:00Z");

  const result = await validatePublicSnapshotForPublication({
    candidate: newerGeneration,
    existingLastKnownGood: existing,
    nowMs: Date.parse("2026-08-11T02:01:00Z"),
  });

  assert.equal(result.ok, true, result.errors.join("\n"));
});
