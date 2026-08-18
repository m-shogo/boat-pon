import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function staleLoaderReport(): N2TrifectaPrivateMarketFeatureLoadReport {
  const sequence = {
    status: "PASS",
    availableCheckpoints: ["T-30", "T-20", "T-10", "T-5"],
    missingCheckpoints: [],
    snapshots: [],
    transitions: [],
  } as unknown as N2TrifectaMarketRaceFeatureSequence;

  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v0",
    status: "PASS",
    blockers: [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence,
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: "a".repeat(64),
  } as unknown as N2TrifectaPrivateMarketFeatureLoadReport;
}

test("feature artifact writer rejects stale loader contract before persistence", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-loader-version-"));
  try {
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: staleLoaderReport(),
        generatedAt: "2026-08-07T02:00:00.000Z",
      }),
      /PRIVATE_FEATURE_ARTIFACT_SOURCE_VERSION_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
