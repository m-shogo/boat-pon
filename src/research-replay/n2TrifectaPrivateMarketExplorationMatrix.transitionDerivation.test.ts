import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  buildN2TrifectaMarketRaceFeatureSequence,
  type N2TrifectaMarketCheckpointLabel,
  type N2TrifectaMarketSnapshotInput,
} from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import {
  buildN2TrifectaPrivateMarketExperimentInputManifest,
  writeN2TrifectaPrivateMarketExperimentInputManifest,
} from "./n2TrifectaPrivateMarketExperimentInputManifest.js";
import { buildN2TrifectaPrivateMarketExplorationMatrix } from
  "./n2TrifectaPrivateMarketExplorationMatrix.js";

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
        const base = 5 + ordinal * 0.7;
        const direction = ordinal % 3 === 0 ? -1 : ordinal % 3 === 1 ? 1 : 0;
        odds[selection] = Math.max(1.1, base * (1 + direction * step * 0.02));
        ordinal += 1;
      }
    }
  }
  return odds;
}

function sequenceFor(raceIdentity: string) {
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
  return sequence;
}

function createFixture(root: string): { manifestDigest: string; featurePath: string } {
  const date = "2026-08-07";
  const venueCode = "10";
  const raceNo = 4;
  const raceIdentity = "20260807-10-04";
  const sequence = sequenceFor(raceIdentity);
  const report: N2TrifectaPrivateMarketFeatureLoadReport = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: "PASS",
    blockers: [],
    date,
    venueCode,
    raceNo,
    raceIdentity,
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
    outputDigest: canonicalHash({ raceIdentity, sequenceDigest: sequence.outputDigest }),
  };
  const featureWrite = writeN2TrifectaPrivateMarketFeatureArtifact({
    rootDir: root,
    report,
    generatedAt: "2026-08-07T03:00:00.000Z",
  });
  const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: root,
    date,
    venueCode,
    generatedAt: "2026-08-07T03:05:00.000Z",
  });
  writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
  const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({
    rootDir: root,
    scopes: [{ date, venueCode }],
  });
  writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest });
  return { manifestDigest: manifest.manifestDigest, featurePath: join(root, featureWrite.relativePath) };
}

test("rejects a fully rehashed transition whose aggregates do not derive from adjacent snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-transition-derivation-"));
  try {
    const { manifestDigest, featurePath } = createFixture(root);
    const artifact = JSON.parse(readFileSync(featurePath, "utf8")) as any;
    const transition = artifact.sequence.transitions[0];
    transition.jensenShannonDivergenceBits += 0.01;
    delete transition.outputDigest;
    transition.outputDigest = canonicalHash(transition);
    delete artifact.sequence.outputDigest;
    artifact.sequence.outputDigest = canonicalHash(artifact.sequence);
    delete artifact.artifactDigest;
    artifact.artifactDigest = canonicalHash(artifact);
    writeFileSync(featurePath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(featurePath, 0o600);

    const manifestPath = join(
      root,
      "data/private/trifecta-market-experiments/manifests",
      `${manifestDigest}.json`,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as any;
    manifest.races[0].featureArtifactDigest = artifact.artifactDigest;
    delete manifest.manifestDigest;
    const rehashedManifestDigest = canonicalHash(manifest);
    manifest.manifestDigest = rehashedManifestDigest;
    const rehashedManifestPath = join(
      root,
      "data/private/trifecta-market-experiments/manifests",
      `${rehashedManifestDigest}.json`,
    );
    writeFileSync(rehashedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(rehashedManifestPath, 0o600);

    assert.throws(
      () => buildN2TrifectaPrivateMarketExplorationMatrix({
        rootDir: root,
        manifestDigest: rehashedManifestDigest,
      }),
      /EXPLORATION_MATRIX_T30_TO_T20_TRANSITION_DERIVATION_MISMATCH/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
