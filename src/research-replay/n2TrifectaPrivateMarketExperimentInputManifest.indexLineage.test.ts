import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION, writeN2TrifectaPrivateMarketFeatureArtifact } from
  "./n2TrifectaPrivateMarketFeatureArtifact.js";
import { buildN2TrifectaPrivateMarketFeatureDayIndex, writeN2TrifectaPrivateMarketFeatureDayIndex } from
  "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import { buildN2TrifectaPrivateMarketExperimentInputManifest } from
  "./n2TrifectaPrivateMarketExperimentInputManifest.js";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function passReport(): N2TrifectaPrivateMarketFeatureLoadReport {
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
      blockers: [],
      raceIdentity: "20260807-10-01",
      availableCheckpoints: [...checkpoints],
      missingCheckpoints: [],
      snapshots: checkpoints.map((checkpointLabel, index) => ({ checkpointLabel, index })),
      transitions: checkpoints.slice(1).map((checkpointLabel, index) => ({
        fromCheckpointLabel: checkpoints[index],
        toCheckpointLabel: checkpointLabel,
      })),
      privateResearchOnly: true,
      publicPublishAuthorized: false,
      databaseWriteAuthorized: false,
      outputDigest: "a".repeat(64),
    } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: "b".repeat(64),
  };
}

test("experiment input rejects a rehashed day index that invents a PASS race", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-experiment-index-lineage-"));
  try {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: passReport(),
      generatedAt: "2026-08-07T03:00:00.000Z",
    });
    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T03:05:00.000Z",
    });
    const written = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    const path = join(root, written.relativePath);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const races = tampered.races as Record<string, unknown>[];
    races[1] = {
      raceNo: 2,
      raceIdentity: "20260807-10-02",
      status: "PASS",
      availableCheckpoints: [...checkpoints],
      missingCheckpoints: [],
      snapshotCount: 4,
      transitionCount: 3,
      sourceLoadDigest: "c".repeat(64),
      featureArtifactDigest: "d".repeat(64),
      featureArtifactVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION,
      featureArtifactRelativePath: "data/private/trifecta-market-features/2026-08-07/10/02.json",
    };
    tampered.passCount = 2;
    tampered.noDataCount = 10;
    tampered.totalSnapshotCount = 8;
    tampered.totalTransitionCount = 6;
    const { indexDigest: _indexDigest, ...core } = tampered;
    tampered.indexDigest = canonicalHash(core);
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    assert.throws(
      () => buildN2TrifectaPrivateMarketExperimentInputManifest({
        rootDir: root,
        scopes: [{ date: "2026-08-07", venueCode: "10" }],
      }),
      /DAY_INDEX_SOURCE_LINEAGE_MISMATCH/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
