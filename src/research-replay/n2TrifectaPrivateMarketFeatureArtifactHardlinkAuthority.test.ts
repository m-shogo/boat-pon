import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from
  "./n2TrifectaPrivateMarketFeatureArtifact.js";

function sourceReport(): N2TrifectaPrivateMarketFeatureLoadReport {
  const sequence = {
    status: "PARTIAL",
    availableCheckpoints: ["T-30"],
    missingCheckpoints: ["T-20", "T-10", "T-5"],
    snapshots: [],
    transitions: [],
  } as unknown as N2TrifectaMarketRaceFeatureSequence;
  const core = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1" as const,
    status: "PARTIAL" as const,
    blockers: [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: 1,
    loadedSnapshotCount: 1,
    sequence,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawValuesReadPrivately: true,
    rawValuesPublished: false as const,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

test("hardlinked derived feature artifact cannot act as idempotent reuse authority", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-hardlink-authority-"));
  try {
    const source = sourceReport();
    const first = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const target = join(root, first.relativePath);
    const alias = join(root, "feature-artifact-alias.json");
    linkSync(target, alias);

    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: source,
        generatedAt: "2026-08-07T03:00:00.000Z",
      }),
      /PRIVATE_FEATURE_EXISTING_HARDLINK_NOT_ALLOWED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
