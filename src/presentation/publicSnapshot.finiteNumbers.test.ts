import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import { validatePublicDashboardSnapshot } from "./publicSnapshot";
import { sealPublicDashboardSnapshot } from "./publicSnapshotTransport";

function snapshotWithMetric(value: number, maxHitExcludedValue?: number): PublicDashboardSnapshot {
  const snapshot = structuredClone(fixture) as PublicDashboardSnapshot;
  snapshot.metrics = [{
    id: "finite-check",
    label: "finite check",
    value,
    unit: null,
    sampleSize: null,
    period: null,
    basis: "data-quality",
    ...(maxHitExcludedValue === undefined ? {} : { maxHitExcludedValue }),
  }];
  return snapshot;
}

test("validator rejects non-finite metric values before canonicalization", async () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const snapshot = snapshotWithMetric(value);
    const result = validatePublicDashboardSnapshot(snapshot);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /metrics\[0\]\.value: finite number, string or null required/);
    await assert.rejects(
      sealPublicDashboardSnapshot(snapshot),
      /Invalid public dashboard snapshot/,
    );
  }
});

test("validator rejects non-finite maxHitExcludedValue", () => {
  const snapshot = snapshotWithMetric(1, Number.POSITIVE_INFINITY);
  const result = validatePublicDashboardSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /metrics\[0\]\.maxHitExcludedValue: finite number, string or null required/,
  );
});
