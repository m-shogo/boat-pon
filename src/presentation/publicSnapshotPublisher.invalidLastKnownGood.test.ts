import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { validatePublicSnapshotForPublication } from "./publicSnapshotPublisher";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

function snapshotAt(generatedAt: string, dataAsOf = generatedAt): PublicDashboardSnapshot {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.generatedAt = generatedAt;
  snapshot.dataAsOf = dataAsOf;
  snapshot.status.lastRunAt = dataAsOf;
  snapshot.status.snapshotFreshness = "FRESH";
  snapshot.integrity.digest = "0".repeat(64);
  return snapshot;
}

test("publication replaces a future last-known-good instead of treating it as rollback authority", async () => {
  const candidate = await sealPublicDashboardSnapshot(snapshotAt("2026-08-11T00:00:00.000Z"));
  const poisonedLastKnownGood = await sealPublicDashboardSnapshot(snapshotAt("2026-08-12T00:00:00.000Z"));

  const result = await validatePublicSnapshotForPublication({
    candidate,
    existingLastKnownGood: poisonedLastKnownGood,
    nowMs: Date.parse("2026-08-11T00:01:00.000Z"),
    maxFutureSkewMs: 5 * 60_000,
  });

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.snapshot?.integrity.digest, candidate.integrity.digest);
  assert.deepEqual(result.warnings, ["EXISTING_LAST_KNOWN_GOOD_INVALID_REPLACED"]);
});

test("publication replaces a last-known-good whose dataAsOf is after its generation beyond skew", async () => {
  const candidate = await sealPublicDashboardSnapshot(snapshotAt("2026-08-11T00:00:00.000Z"));
  const inconsistentLastKnownGood = await sealPublicDashboardSnapshot(
    snapshotAt("2026-08-10T23:00:00.000Z", "2026-08-11T00:30:00.000Z"),
  );

  const result = await validatePublicSnapshotForPublication({
    candidate,
    existingLastKnownGood: inconsistentLastKnownGood,
    nowMs: Date.parse("2026-08-11T01:00:00.000Z"),
    maxFutureSkewMs: 5 * 60_000,
  });

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.snapshot?.integrity.digest, candidate.integrity.digest);
  assert.deepEqual(result.warnings, ["EXISTING_LAST_KNOWN_GOOD_INVALID_REPLACED"]);
});
