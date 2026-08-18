import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import { buildN2TrifectaPrivateMarketFeatureDayIndex } from "./n2TrifectaPrivateMarketFeatureDayIndex.js";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function syntheticPassReport(): N2TrifectaPrivateMarketFeatureLoadReport {
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
      featureVersion: "n2-trifecta-market-features-v1",
      status: "PASS",
      raceIdentity: "20260807-10-01",
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
    outputDigest: "1".padStart(64, "0"),
  };
}

test("day index rejects a rehashed artifact whose nested sequence status contradicts the artifact status", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-day-index-sequence-status-"));
  try {
    const written = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticPassReport(),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, written.relativePath);
    const artifact = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const sequence = artifact.sequence as Record<string, unknown>;
    sequence.status = "BLOCKED";
    const {
      artifactDigest: _artifactDigest,
      ...core
    } = artifact;
    artifact.artifactDigest = canonicalHash(core);
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
        generatedAt: "2026-08-07T02:05:00.000Z",
      }),
      /R1_SEQUENCE_STATUS_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("day index rejects rehashed nested sequence version and race lineage drift", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-day-index-sequence-lineage-"));
  try {
    const written = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: syntheticPassReport(),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, written.relativePath);
    const originalContent = readFileSync(path, "utf8");

    for (const [field, value, expected] of [
      ["featureVersion", "n2-trifecta-market-features-v0", /R1_SEQUENCE_VERSION_INVALID/u],
      ["raceIdentity", "20260807-10-02", /R1_SEQUENCE_RACE_IDENTITY_INVALID/u],
    ] as const) {
      writeFileSync(path, originalContent, "utf8");
      const artifact = JSON.parse(originalContent) as Record<string, unknown>;
      const sequence = artifact.sequence as Record<string, unknown>;
      sequence[field] = value;
      const { artifactDigest: _artifactDigest, ...core } = artifact;
      artifact.artifactDigest = canonicalHash(core);
      writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

      assert.throws(
        () => buildN2TrifectaPrivateMarketFeatureDayIndex({
          rootDir: root,
          date: "2026-08-07",
          venueCode: "10",
          generatedAt: "2026-08-07T02:05:00.000Z",
        }),
        expected,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
