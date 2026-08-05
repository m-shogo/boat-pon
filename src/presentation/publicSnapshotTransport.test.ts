import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import type { PublicDashboardSnapshot } from "./publicSnapshot";
import {
  canonicalizePublicSnapshotValue,
  loadPublicDashboardSnapshot,
  sealPublicDashboardSnapshot,
  verifyPublicDashboardSnapshotIntegrity,
  type PublicSnapshotFetcher,
} from "./publicSnapshotTransport";

function fixtureSnapshot(): PublicDashboardSnapshot {
  return structuredClone(fixture) as PublicDashboardSnapshot;
}

function response(value: unknown, status = 200): ReturnType<PublicSnapshotFetcher> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(value);
    },
  });
}

test("canonical JSON is stable across object key order", () => {
  assert.equal(
    canonicalizePublicSnapshotValue({ z: 1, a: { y: true, b: [2, 1] } }),
    canonicalizePublicSnapshotValue({ a: { b: [2, 1], y: true }, z: 1 }),
  );
});

test("sealed snapshot verifies and content tampering fails", async () => {
  const sealed = await sealPublicDashboardSnapshot(fixtureSnapshot());
  const verified = await verifyPublicDashboardSnapshotIntegrity(sealed);
  assert.equal(verified.ok, true, verified.errors.join("\n"));

  const tampered = structuredClone(sealed);
  tampered.status.nextTask = "TASK-N2-999";
  const rejected = await verifyPublicDashboardSnapshotIntegrity(tampered);
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join("\n"), /digest mismatch/);
});

test("network loader returns a verified fresh snapshot", async () => {
  const sealed = await sealPublicDashboardSnapshot(fixtureSnapshot());
  const nowMs = Date.parse(sealed.dataAsOf) + 60_000;
  const result = await loadPublicDashboardSnapshot({
    nowMs,
    maxAgeMs: 5 * 60_000,
    fetcher: async () => response(sealed),
  });

  assert.equal(result.source, "network");
  assert.equal(result.observedFreshness, "FRESH");
  assert.equal(result.snapshot?.integrity.digest, sealed.integrity.digest);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ["DECLARED_FRESHNESS_MISMATCH"]);
});

test("network loader derives stale state without mutating the signed snapshot", async () => {
  const source = fixtureSnapshot();
  source.status.snapshotFreshness = "STALE";
  const sealed = await sealPublicDashboardSnapshot(source);
  const result = await loadPublicDashboardSnapshot({
    nowMs: Date.parse(sealed.dataAsOf) + 3 * 60 * 60_000,
    maxAgeMs: 2 * 60 * 60_000,
    fetcher: async () => response(sealed),
  });

  assert.equal(result.observedFreshness, "STALE");
  assert.equal(result.snapshot?.status.snapshotFreshness, "STALE");
  assert.deepEqual(result.warnings, []);
});

test("invalid, unsigned, future and unavailable snapshots fail closed", async () => {
  const unsigned = fixtureSnapshot();
  const unsignedResult = await loadPublicDashboardSnapshot({
    nowMs: Date.parse(unsigned.dataAsOf),
    fetcher: async () => response(unsigned),
  });
  assert.equal(unsignedResult.snapshot, null);
  assert.deepEqual(unsignedResult.errors, ["INVALID_OR_UNVERIFIED_SNAPSHOT"]);

  const future = fixtureSnapshot();
  future.dataAsOf = "2026-08-05T06:00:00.000Z";
  future.generatedAt = future.dataAsOf;
  const sealedFuture = await sealPublicDashboardSnapshot(future);
  const futureResult = await loadPublicDashboardSnapshot({
    nowMs: Date.parse("2026-08-05T05:00:00.000Z"),
    maxFutureSkewMs: 5 * 60_000,
    fetcher: async () => response(sealedFuture),
  });
  assert.equal(futureResult.snapshot, null);
  assert.deepEqual(futureResult.errors, ["FUTURE_DATA_AS_OF"]);

  const httpResult = await loadPublicDashboardSnapshot({
    fetcher: async () => response({}, 503),
  });
  assert.equal(httpResult.observedFreshness, "NOT_AVAILABLE");
  assert.deepEqual(httpResult.errors, ["HTTP_503"]);

  const networkResult = await loadPublicDashboardSnapshot({
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(networkResult.snapshot, null);
  assert.deepEqual(networkResult.errors, ["NETWORK_ERROR"]);
});
