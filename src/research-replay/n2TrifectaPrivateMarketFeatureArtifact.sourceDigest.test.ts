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

function validLoaderReport(): N2TrifectaPrivateMarketFeatureLoadReport {
  const sequence = {
    status: "PASS",
    availableCheckpoints: ["T-30", "T-20", "T-10", "T-5"],
    missingCheckpoints: [],
    snapshots: [],
    transitions: [],
  } as unknown as N2TrifectaMarketRaceFeatureSequence;

  const core = {
    loaderVersion: N2_TRIFECTA_PRIVATE_MARKET_FEATURE_LOADER_VERSION,
    status: "PASS" as const,
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
  };

  return { ...core, outputDigest: canonicalHash(core) } as unknown as N2TrifectaPrivateMarketFeatureLoadReport;
}

test("feature artifact writer rejects a valid-looking loader digest that does not match report content", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-loader-digest-"));
  try {
    const report = validLoaderReport();
    const tampered = {
      ...report,
      outputDigest: report.outputDigest === "b".repeat(64) ? "c".repeat(64) : "b".repeat(64),
    } as N2TrifectaPrivateMarketFeatureLoadReport;

    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: tampered,
        generatedAt: "2026-08-07T02:00:00.000Z",
      }),
      /PRIVATE_FEATURE_ARTIFACT_SOURCE_DIGEST_MISMATCH/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
