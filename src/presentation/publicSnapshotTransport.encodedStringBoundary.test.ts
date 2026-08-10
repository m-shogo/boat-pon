import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import {
  computePublicDashboardSnapshotDigest,
  sealPublicDashboardSnapshot,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

function signedSnapshotWithNote(note: string): Promise<PublicDashboardSnapshot> {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.dataQuality.notes = [note];
  snapshot.integrity.digest = "0".repeat(64);
  return computePublicDashboardSnapshotDigest(snapshot).then((digest) => {
    snapshot.integrity.digest = digest;
    return snapshot;
  });
}

test("snapshot sealing rejects encoded private path controls in free text", async () => {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.dataQuality.notes = ["automation%2fcontrol%2fplanner-candidates.json"];
  snapshot.integrity.digest = "0".repeat(64);

  await assert.rejects(
    () => sealPublicDashboardSnapshot(snapshot),
    /\$\.dataQuality\.notes\[0\]: encoded path control is forbidden/,
  );
});

test("integrity verification rejects externally signed encoded private path controls in free text", async () => {
  const snapshot = await signedSnapshotWithNote("automation%2fcontrol%2fplanner-candidates.json");
  const result = await verifyPublicDashboardSnapshotIntegrity(snapshot);

  assert.equal(result.ok, false);
  assert.equal(result.snapshot, null);
  assert.match(result.errors.join("\n"), /\$\.dataQuality\.notes\[0\]: encoded path control is forbidden/);
});

test("integrity verification rejects double-encoded path controls in free text", async () => {
  const snapshot = await signedSnapshotWithNote("automation%252fcontrol%252fplanner-candidates.json");
  const result = await verifyPublicDashboardSnapshotIntegrity(snapshot);

  assert.equal(result.ok, false);
  assert.equal(result.snapshot, null);
  assert.match(result.errors.join("\n"), /\$\.dataQuality\.notes\[0\]: encoded path control is forbidden/);
});