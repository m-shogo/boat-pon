import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  buildN2TrifectaMarketRaceFeatureSequence,
  type N2TrifectaMarketCheckpointLabel,
  type N2TrifectaMarketSnapshotInput,
} from "./n2TrifectaMarketFeatureEngineering.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import {
  buildN2TrifectaPrivateMarketExperimentInputManifest,
  writeN2TrifectaPrivateMarketExperimentInputManifest,
} from "./n2TrifectaPrivateMarketExperimentInputManifest.js";
import { buildN2TrifectaPrivateMarketExplorationMatrix } from "./n2TrifectaPrivateMarketExplorationMatrix.js";

const checkpoints: N2TrifectaMarketCheckpointLabel[] = ["T-30", "T-20", "T-10", "T-5"];

function oddsForStep(step: number): Record<string, number> {
  const odds: Record<string, number> = {};
  let ordinal = 0;
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        const selection = `${first}-${second}-${third}`;
        odds[selection] = Math.max(1.1, (5 + ordinal * 0.7) * (1 + (ordinal % 3 - 1) * step * 0.02));
        ordinal += 1;
      }
    }
  }
  return odds;
}

function completeReport(): N2TrifectaPrivateMarketFeatureLoadReport {
  const date = "2026-08-07";
  const venueCode = "10";
  const raceNo = 4;
  const raceIdentity = "20260807-10-04";
  const baseMs = Date.parse("2026-08-07T01:00:00.000Z");
  const inputs: N2TrifectaMarketSnapshotInput[] = checkpoints.map((checkpointLabel, index) => ({
    raceIdentity,
    checkpointLabel,
    capturedAt: new Date(baseMs + index * 600_000).toISOString(),
    availableAt: new Date(baseMs + index * 600_000 - 20_000).toISOString(),
    odds: oddsForStep(index),
  }));
  const sequence = buildN2TrifectaMarketRaceFeatureSequence(inputs);
  assert.equal(sequence.status, "PASS");
  const reportCore = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    date,
    venueCode,
    raceNo,
    raceIdentity,
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
  return { ...reportCore, outputDigest: canonicalHash(reportCore) };
}

function rehash(record: Record<string, unknown>, field: string): string {
  const core = { ...record };
  delete core[field];
  const digest = canonicalHash(core);
  record[field] = digest;
  return digest;
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-exploration-snapshot-time-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("rejects rehashed feature snapshots with producer-invalid timestamps", () => {
  for (const capturedAt of [
    "2026-08-07T24:00:00.000Z",
    "2026-02-30T01:00:00.000Z",
    "2026-08-07T01:00:00",
  ]) {
    withRoot((root) => {
      const report = completeReport();
      const featureWrite = writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report,
        generatedAt: "2026-08-07T03:00:00.000Z",
      });
      const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
        rootDir: root,
        date: "2026-08-07",
        venueCode: "10",
        generatedAt: "2026-08-07T03:05:00.000Z",
      });
      writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
      const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({
        rootDir: root,
        scopes: [{ date: "2026-08-07", venueCode: "10" }],
      });
      writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest });

      const featurePath = join(root, featureWrite.relativePath);
      const artifact = JSON.parse(readFileSync(featurePath, "utf8")) as any;
      const snapshot = artifact.sequence.snapshots[0] as Record<string, unknown>;
      snapshot.capturedAt = capturedAt;
      rehash(snapshot, "outputDigest");
      rehash(artifact.sequence as Record<string, unknown>, "outputDigest");
      const artifactDigest = rehash(artifact as Record<string, unknown>, "artifactDigest");
      writeFileSync(featurePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      chmodSync(featurePath, 0o600);

      const manifestRecord = { ...manifest } as unknown as Record<string, unknown>;
      const races = manifestRecord.races as Array<Record<string, unknown>>;
      races[0].featureArtifactDigest = artifactDigest;
      const manifestDigest = rehash(manifestRecord, "manifestDigest");
      const manifestPath = join(
        root,
        "data/private/trifecta-market-experiments/manifests",
        `${manifestDigest}.json`,
      );
      writeFileSync(manifestPath, `${JSON.stringify(manifestRecord, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      chmodSync(manifestPath, 0o600);

      assert.throws(
        () => buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest }),
        /EXPLORATION_MATRIX_T30_PIT_TIME_INVALID/u,
      );
    });
  }
});

test("keeps explicit-offset snapshot timestamps compatible with the producer contract", () => {
  const raceIdentity = "20260807-10-04";
  const inputs: N2TrifectaMarketSnapshotInput[] = checkpoints.map((checkpointLabel, index) => ({
    raceIdentity,
    checkpointLabel,
    capturedAt: `2026-08-07T${String(10 + index).padStart(2, "0")}:00:00+09:00`,
    availableAt: `2026-08-07T${String(9 + index).padStart(2, "0")}:59:40+09:00`,
    odds: oddsForStep(index),
  }));
  const sequence = buildN2TrifectaMarketRaceFeatureSequence(inputs);
  assert.equal(sequence.status, "PASS");
});
