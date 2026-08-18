import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function report(): N2TrifectaPrivateMarketFeatureLoadReport {
  const core = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: "PASS" as const,
    blockers: [] as string[],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence: {
      featureVersion: "n2-trifecta-market-features-v1",
      status: "PASS",
      blockers: [],
      raceIdentity: "20260807-10-04",
      availableCheckpoints: ["T-30", "T-20", "T-10", "T-5"],
      missingCheckpoints: [],
      snapshots: [],
      transitions: [],
      privateResearchOnly: true,
      publicPublishAuthorized: false,
      databaseWriteAuthorized: false,
      outputDigest: "a".repeat(64),
    } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawValuesReadPrivately: true,
    rawValuesPublished: false as const,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) } as N2TrifectaPrivateMarketFeatureLoadReport;
}

test("same source digest rebuilds a rehashed artifact whose nested sequence drifted", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-artifact-sequence-reuse-"));
  try {
    const source = report();
    const first = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, first.relativePath);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const sequence = tampered.sequence as Record<string, unknown>;
    sequence.raceIdentity = "20260807-10-05";
    const { artifactDigest: _artifactDigest, ...tamperedCore } = tampered;
    tampered.artifactDigest = canonicalHash(tamperedCore);
    const tamperedDigest = tampered.artifactDigest;
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const repaired = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T02:30:00.000Z",
    });

    assert.equal(repaired.changed, true);
    assert.equal(repaired.replacedExisting, true);
    assert.notEqual(repaired.artifactDigest, tamperedDigest);
    const disk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.deepEqual(disk.sequence, source.sequence);
    assert.equal(disk.generatedAt, "2026-08-07T02:30:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});