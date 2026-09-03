import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import { buildN2TrifectaPrivateMarketFeatureDayIndex } from "./n2TrifectaPrivateMarketFeatureDayIndex.js";

function report(): N2TrifectaPrivateMarketFeatureLoadReport {
  const raceIdentity = "20260807-10-01";
  const sequenceCore = {
    featureVersion: "n2-trifecta-market-features-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    raceIdentity,
    availableCheckpoints: ["T-30", "T-20", "T-10", "T-5"] as const,
    missingCheckpoints: [] as const,
    snapshots: [0, 1, 2, 3].map((syntheticSnapshotIndex) => ({ syntheticSnapshotIndex })),
    transitions: [1, 2, 3].map((syntheticTransitionIndex) => ({ syntheticTransitionIndex })),
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
  };
  const reportCore = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 1,
    raceIdentity,
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence: { ...sequenceCore, outputDigest: canonicalHash(sequenceCore) } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawValuesReadPrivately: true as const,
    rawValuesPublished: false as const,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
  };
  return { ...reportCore, outputDigest: canonicalHash(reportCore) };
}

test("day index rejects a valid private feature artifact that has a hardlink alias", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-index-hardlink-"));
  try {
    const written = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: report(),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const canonicalPath = join(root, written.relativePath);
    linkSync(canonicalPath, join(root, "feature-artifact-alias.json"));

    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
        generatedAt: "2026-08-07T02:05:00.000Z",
      }),
      /R1_FEATURE_FILE_HARDLINK_NOT_ALLOWED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
