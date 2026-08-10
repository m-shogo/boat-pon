import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import {
  computePublicDashboardSnapshotDigest,
  sealPublicDashboardSnapshot,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

function snapshotWithEvidence(path: string): PublicDashboardSnapshot {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.pipeline = [{
    taskId: "TASK-PLANNER-NEXT",
    label: "queue planner",
    status: "READY",
    dependencies: [],
    evidence: [path],
  }];
  snapshot.integrity.digest = "0".repeat(64);
  return snapshot;
}

test("snapshot sealing rejects percent-encoded evidence path controls", async () => {
  await assert.rejects(
    () => sealPublicDashboardSnapshot(snapshotWithEvidence("reports/n2/%2e%2e/private.json")),
    /encoded path control is forbidden/,
  );
});

test("integrity verification rejects externally signed encoded path controls", async () => {
  const snapshot = snapshotWithEvidence("reports/n2/safe%2f..%2fprivate.json");
  snapshot.integrity.digest = await computePublicDashboardSnapshotDigest(snapshot);

  const result = await verifyPublicDashboardSnapshotIntegrity(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot, null);
  assert.match(result.errors.join("\n"), /encoded path control is forbidden/);
});

test("integrity verification rejects encoded methodology path controls", async () => {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.methodologyReferences = [{
    label: "encoded private path",
    path: "/methodology/%2e%2e%2fautomation%2fcontrol%2fprivate",
  }];
  snapshot.integrity.digest = await computePublicDashboardSnapshotDigest(snapshot);

  const result = await verifyPublicDashboardSnapshotIntegrity(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.snapshot, null);
  assert.match(result.errors.join("\n"), /encoded path control is forbidden/);
});