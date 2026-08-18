import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function syntheticReport(): N2TrifectaPrivateMarketFeatureLoadReport {
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: "PASS",
    blockers: [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 1,
    raceIdentity: "20260807-10-01",
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence: {
      status: "PASS",
      availableCheckpoints: [...checkpoints],
      missingCheckpoints: [],
      snapshots: checkpoints.map((checkpointLabel, index) => ({ checkpointLabel, syntheticSnapshotIndex: index })),
      transitions: checkpoints.slice(1).map((checkpointLabel, index) => ({
        fromCheckpointLabel: checkpoints[index],
        toCheckpointLabel: checkpointLabel,
      })),
    } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: "1".repeat(64),
  };
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-feature-day-index-time-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("day index generatedAt rejects normalized timestamps and canonicalizes valid offsets", () => {
  withRoot((root) => {
    for (const generatedAt of [
      "2026-08-07T24:00:00.000Z",
      "2026-02-30T02:00:00.000Z",
      "2026-08-07T02:00:00",
    ]) {
      assert.throws(
        () => buildN2TrifectaPrivateMarketFeatureDayIndex({
          rootDir: root,
          date: "2026-08-07",
          venueCode: "10",
          generatedAt,
        }),
        /PRIVATE_FEATURE_DAY_INDEX_GENERATED_AT_INVALID/u,
        generatedAt,
      );
    }

    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T11:05:00+09:00",
    });
    assert.equal(index.generatedAt, "2026-08-07T02:05:00.000Z");
  });
});

test("day index rejects a feature artifact with a non-canonical generatedAt representation", () => {
  withRoot((root) => {
    const written = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticReport(),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, written.relativePath);
    const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    artifact.generatedAt = "2026-08-07T11:00:00+09:00";
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
        generatedAt: "2026-08-07T02:05:00.000Z",
      }),
      /R1_GENERATED_AT_INVALID/u,
    );
  });
});

test("non-canonical persisted index time is rebuilt instead of semantically reused", () => {
  withRoot((root) => {
    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });
    const first = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    const path = join(root, first.relativePath);
    const persisted = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    persisted.generatedAt = "2026-08-07T11:05:00+09:00";
    writeFileSync(path, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const later = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:10:00.000Z",
    });
    const repaired = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: later });
    assert.equal(repaired.changed, true);
    const disk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(disk.generatedAt, "2026-08-07T02:10:00.000Z");
  });
});
