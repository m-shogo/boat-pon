import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function syntheticReport(): N2TrifectaPrivateMarketFeatureLoadReport {
  const snapshots = checkpoints.map((checkpointLabel, index) => ({ checkpointLabel, syntheticSnapshotIndex: index }));
  const transitions = checkpoints.slice(1).map((checkpointLabel, index) => ({
    fromCheckpointLabel: checkpoints[index],
    toCheckpointLabel: checkpointLabel,
  }));
  const raceIdentity = "20260807-10-01";
  const sequenceCore = {
    featureVersion: "n2-trifecta-market-features-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    raceIdentity,
    availableCheckpoints: [...checkpoints],
    missingCheckpoints: [] as string[],
    snapshots,
    transitions,
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

test("day index rejects symlinked feature ancestry for both reads and writes", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-day-index-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-day-index-external-"));
  try {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: external,
      report: syntheticReport(),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const trustedIndex = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: external,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });
    const externalIndexPath = join(
      external,
      "data/private/trifecta-market-features/2026-08-07/10/index.json",
    );
    assert.equal(existsSync(externalIndexPath), false);

    mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
    symlinkSync(
      join(external, "data/private/trifecta-market-features"),
      join(root, "data/private/trifecta-market-features"),
      "dir",
    );

    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
        generatedAt: "2026-08-07T02:05:00.000Z",
      }),
      /R1_FEATURE_PARENT_INVALID/u,
    );
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: trustedIndex }),
      /PRIVATE_FEATURE_DAY_INDEX_PARENT_INVALID/u,
    );
    assert.equal(existsSync(externalIndexPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
