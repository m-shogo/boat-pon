import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import {
  N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION,
  type N2TrifectaPrivateMarketFeatureLoadReport,
} from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function loaderReport(input: { staleVersion?: boolean } = {}): N2TrifectaPrivateMarketFeatureLoadReport {
  const sequence = {
    status: "PASS",
    availableCheckpoints: ["T-30", "T-20", "T-10", "T-5"],
    missingCheckpoints: [],
    snapshots: [],
    transitions: [],
  } as unknown as N2TrifectaMarketRaceFeatureSequence;
  const core = {
    loaderVersion: input.staleVersion
      ? "n2-trifecta-private-market-feature-loader-v0"
      : N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawValuesReadPrivately: true,
    rawValuesPublished: false as const,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) } as unknown as N2TrifectaPrivateMarketFeatureLoadReport;
}

test("feature artifact writer rejects stale loader contract before persistence", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-loader-version-"));
  try {
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: loaderReport({ staleVersion: true }),
        generatedAt: "2026-08-07T02:00:00.000Z",
      }),
      /PRIVATE_FEATURE_ARTIFACT_SOURCE_VERSION_INVALID/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feature artifact writer rejects a loader report whose body drifted after digesting", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-loader-digest-"));
  try {
    const report = loaderReport();
    report.acceptedMarkerCount = 3;
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report,
        generatedAt: "2026-08-07T02:00:00.000Z",
      }),
      /PRIVATE_FEATURE_ARTIFACT_SOURCE_DIGEST_MISMATCH/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
