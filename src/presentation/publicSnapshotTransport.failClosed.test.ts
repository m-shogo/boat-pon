import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import {
  loadPublicDashboardSnapshot,
  verifyPublicDashboardSnapshotIntegrity,
  type PublicSnapshotFetcher,
} from "./publicSnapshotTransport";

function nonFiniteSnapshot(): Record<string, any> {
  const value = structuredClone(fixture) as Record<string, any>;
  value.metrics = [{
    id: "non-finite",
    label: "non-finite metric",
    value: Number.NaN,
    unit: null,
    sampleSize: null,
    period: null,
    basis: "not-available",
  }];
  return value;
}

function response(value: unknown): ReturnType<PublicSnapshotFetcher> {
  return Promise.resolve({
    ok: true,
    status: 200,
    async json() {
      return structuredClone(value);
    },
  });
}

test("integrity verifier fails closed when canonicalization rejects a validator-accepted value", async () => {
  const result = await verifyPublicDashboardSnapshotIntegrity(nonFiniteSnapshot());
  assert.equal(result.ok, false);
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.errors, ["snapshot canonicalization failed"]);
});

test("snapshot loader converts canonicalization failure into unavailable instead of throwing", async () => {
  const result = await loadPublicDashboardSnapshot({
    fallbackUrl: null,
    fetcher: async () => response(nonFiniteSnapshot()),
  });
  assert.equal(result.snapshot, null);
  assert.equal(result.source, "not-available");
  assert.deepEqual(result.errors, ["INVALID_OR_UNVERIFIED_SNAPSHOT"]);
});
