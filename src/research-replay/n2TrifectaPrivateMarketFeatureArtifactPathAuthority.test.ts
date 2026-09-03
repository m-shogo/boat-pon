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
import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function report(): N2TrifectaPrivateMarketFeatureLoadReport {
  const sequence = {
    status: "PASS",
    availableCheckpoints: ["T-30", "T-20", "T-10", "T-5"],
    missingCheckpoints: [],
    snapshots: [],
    transitions: [],
  } as unknown as N2TrifectaMarketRaceFeatureSequence;
  const core = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1" as const,
    status: "PASS" as const,
    blockers: [],
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
  return { ...core, outputDigest: canonicalHash(core) };
}

test("feature artifact writer rejects an intermediate symlink before writing outside root", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-feature-external-"));
  try {
    mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
    symlinkSync(external, join(root, "data/private/trifecta-market-features"), "dir");

    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: report(),
        generatedAt: "2026-08-07T02:00:00.000Z",
      }),
      /PRIVATE_FEATURE_PARENT_DIRECTORY_INVALID/u,
    );
    assert.equal(existsSync(join(external, "2026-08-07/10/04.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
