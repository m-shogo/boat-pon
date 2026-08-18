import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import {
  N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION,
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function syntheticReport(input: {
  raceNo: number;
  status: "PASS" | "PARTIAL";
  availableCount: number;
}): N2TrifectaPrivateMarketFeatureLoadReport {
  const availableCheckpoints = checkpoints.slice(0, input.availableCount);
  const missingCheckpoints = checkpoints.slice(input.availableCount);
  const snapshots = availableCheckpoints.map((checkpointLabel, index) => ({
    checkpointLabel,
    syntheticSnapshotIndex: index,
  }));
  const transitions = availableCheckpoints.slice(1).map((checkpointLabel, index) => ({
    fromCheckpointLabel: availableCheckpoints[index],
    toCheckpointLabel: checkpointLabel,
  }));
  const raceIdentity = `20260807-10-${String(input.raceNo).padStart(2, "0")}`;
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: input.status,
    blockers: [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: input.raceNo,
    raceIdentity,
    acceptedMarkerCount: availableCheckpoints.length,
    loadedSnapshotCount: availableCheckpoints.length,
    sequence: {
      featureVersion: "n2-trifecta-market-features-v1",
      status: input.status,
      raceIdentity,
      availableCheckpoints: [...availableCheckpoints],
      missingCheckpoints: [...missingCheckpoints],
      snapshots,
      transitions,
    } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: input.raceNo.toString(16).padStart(64, "0"),
  };
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-feature-day-index-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("day index verifies private v2 artifacts and summarizes coverage without feature vectors", () => {
  withRoot((root) => {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport({ raceNo: 1, status: "PASS", availableCount: 4 }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport({ raceNo: 2, status: "PARTIAL", availableCount: 2 }),
      generatedAt: "2026-08-07T02:01:00.000Z",
    });

    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });

    assert.equal(index.indexVersion, N2_TRIFECTA_PRIVATE_MARKET_FEATURE_DAY_INDEX_VERSION);
    assert.equal(index.status, "PARTIAL");
    assert.equal(index.raceCount, 12);
    assert.equal(index.passCount, 1);
    assert.equal(index.partialCount, 1);
    assert.equal(index.noDataCount, 10);
    assert.equal(index.totalSnapshotCount, 6);
    assert.equal(index.totalTransitionCount, 4);
    assert.equal(index.races[0]?.status, "PASS");
    assert.deepEqual(index.races[0]?.availableCheckpoints, checkpoints);
    assert.equal(index.races[0]?.snapshotCount, 4);
    assert.equal(index.races[0]?.transitionCount, 3);
    assert.equal(index.races[1]?.status, "PARTIAL");
    assert.deepEqual(index.races[1]?.availableCheckpoints, ["T-30", "T-20"]);
    assert.deepEqual(index.races[1]?.missingCheckpoints, ["T-10", "T-5"]);
    assert.equal(index.races[11]?.status, "NO_DATA");
    assert.equal(index.races[11]?.featureArtifactDigest, null);
    assert.equal(index.privateResearchOnly, true);
    assert.equal(index.publicPublishAuthorized, false);
    assert.equal(index.databaseReadCount, 0);
    assert.equal(index.databaseWriteCount, 0);
    assert.equal(index.networkRequestCount, 0);
    assert.equal(index.rawOddsValuesPublished, false);
    assert.equal(index.currentBuyConnectionAuthorized, false);
    assert.equal(index.lineConnectionAuthorized, false);
    assert.equal(index.automatedBettingAuthorized, false);

    const serialized = JSON.stringify(index);
    assert.doesNotMatch(serialized, /syntheticSnapshotIndex|fromCheckpointLabel|toCheckpointLabel/u);

    const written = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    assert.equal(written.changed, true);
    const path = join(root, written.relativePath);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const disk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(disk.indexDigest, index.indexDigest);
  });
});

test("same deterministic index is idempotent", () => {
  withRoot((root) => {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport({ raceNo: 4, status: "PASS", availableCount: 4 }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });
    const first = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    const second = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.indexDigest, first.indexDigest);
  });
});

test("semantically identical index reuses existing digest across generatedAt changes", () => {
  withRoot((root) => {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport({ raceNo: 4, status: "PASS", availableCount: 4 }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const firstIndex = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });
    const first = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: firstIndex });
    const laterIndex = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:10:00.000Z",
    });
    assert.notEqual(laterIndex.indexDigest, firstIndex.indexDigest);
    const second = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: laterIndex });
    assert.equal(second.changed, false);
    assert.equal(second.indexDigest, first.indexDigest);
    const disk = JSON.parse(readFileSync(join(root, second.relativePath), "utf8")) as Record<string, unknown>;
    assert.equal(disk.indexDigest, firstIndex.indexDigest);
    assert.equal(disk.generatedAt, firstIndex.generatedAt);
  });
});

test("tampered existing index is rebuilt instead of semantically reused", () => {
  withRoot((root) => {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport({ raceNo: 4, status: "PASS", availableCount: 4 }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const firstIndex = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });
    const first = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: firstIndex });
    const path = join(root, first.relativePath);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    tampered.generatedAt = "2026-08-07T02:06:00.000Z";
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const laterIndex = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:10:00.000Z",
    });
    const second = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: laterIndex });
    assert.equal(second.changed, true);
    assert.equal(second.indexDigest, laterIndex.indexDigest);
    const disk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(disk.indexDigest, laterIndex.indexDigest);
    assert.equal(disk.generatedAt, laterIndex.generatedAt);
  });
});

test("tampered or permission-widened feature artifacts fail closed", () => {
  withRoot((root) => {
    const write = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport({ raceNo: 3, status: "PASS", availableCount: 4 }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, write.relativePath);
    const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    artifact.publicPublishAuthorized = true;
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
      }),
      /R3_PROTECTED_BOUNDARY_INVALID/u,
    );

    artifact.publicPublishAuthorized = false;
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    chmodSync(path, 0o644);
    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
      }),
      /R3_FEATURE_FILE_MODE_INVALID/u,
    );
  });
});
