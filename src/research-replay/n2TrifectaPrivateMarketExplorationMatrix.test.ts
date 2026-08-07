import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
import {
  N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS,
  N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_DIGEST,
  N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_MATRIX_VERSION,
  buildN2TrifectaPrivateMarketExplorationMatrix,
  writeN2TrifectaPrivateMarketExplorationMatrix,
} from "./n2TrifectaPrivateMarketExplorationMatrix.js";

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

function completeSequence(raceIdentity: string) {
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

function completeReport(input: {
  date: string;
  venueCode: string;
  raceNo: number;
}): N2TrifectaPrivateMarketFeatureLoadReport {
  const raceIdentity = `${input.date.replaceAll("-", "")}-${input.venueCode}-${String(input.raceNo).padStart(2, "0")}`;
  const sequence = completeSequence(raceIdentity);
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: "PASS",
    blockers: [],
    date: input.date,
    venueCode: input.venueCode,
    raceNo: input.raceNo,
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
}

function createManifest(root: string): { manifestDigest: string; featurePath: string } {
  const report = completeReport({ date: "2026-08-07", venueCode: "10", raceNo: 4 });
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
  return { manifestDigest: manifest.manifestDigest, featurePath: join(root, featureWrite.relativePath) };
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-exploration-matrix-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("materializes a deterministic 85-column unlabeled race-level matrix from a frozen manifest", () => {
  withRoot((root) => {
    const { manifestDigest } = createManifest(root);
    const first = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });
    const second = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });

    assert.equal(first.matrixVersion, N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_MATRIX_VERSION);
    assert.equal(first.evidenceRole, "EXPLORATION_ONLY");
    assert.equal(first.labelPolicy, "NO_OUTCOME_LABELS");
    assert.equal(first.coveragePolicy, "FULL_TRAJECTORY_ONLY");
    assert.equal(first.manifestDigest, manifestDigest);
    assert.equal(first.featureSchemaDigest, N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_FEATURE_SCHEMA_DIGEST);
    assert.equal(first.columns.length, 85);
    assert.deepEqual(first.columns, [...N2_TRIFECTA_PRIVATE_MARKET_EXPLORATION_COLUMNS]);
    assert.equal(first.raceCount, 1);
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0]?.raceIdentity, "20260807-10-04");
    assert.equal(first.rows[0]?.values.length, 85);
    assert.ok(first.rows[0]?.values.every(Number.isFinite));
    assert.equal(first.matrixDigest, second.matrixDigest);
    assert.deepEqual(first.rows, second.rows);
    assert.equal(first.privateFeatureArtifactsRead, true);
    assert.equal(first.rawCaptureEvidenceRead, false);
    assert.equal(first.rawOddsValuesPublished, false);
    assert.equal(first.outcomeDataRead, false);
    assert.equal(first.validationDataRead, false);
    assert.equal(first.holdoutDataRead, false);
    assert.equal(first.networkRequestCount, 0);
    assert.equal(first.databaseReadCount, 0);
    assert.equal(first.databaseWriteCount, 0);
    assert.equal(first.currentBuyConnectionAuthorized, false);
    assert.equal(first.lineConnectionAuthorized, false);
    assert.equal(first.automatedBettingAuthorized, false);
    assert.equal(first.productionApplyAuthorized, false);

    const serialized = JSON.stringify(first);
    assert.doesNotMatch(serialized, /"selections"|"moves"|"favoriteSelection"/u);

    const write = writeN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix: first });
    assert.equal(write.created, true);
    assert.equal(statSync(join(root, write.relativePath)).mode & 0o777, 0o600);
    const repeated = writeN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix: first });
    assert.equal(repeated.created, false);
  });
});

test("matrix values are aggregate snapshot/transition fields and omit selection-level arrays", () => {
  withRoot((root) => {
    const { manifestDigest, featurePath } = createManifest(root);
    const artifact = JSON.parse(readFileSync(featurePath, "utf8")) as any;
    const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });
    const row = matrix.rows[0]!;
    const snapshot = artifact.sequence.snapshots[0];
    assert.deepEqual(row.values.slice(0, 13), [
      snapshot.normalizedEntropy,
      snapshot.effectiveSelectionCount,
      snapshot.herfindahlIndex,
      snapshot.favoriteOdds,
      snapshot.favoriteGapRatio,
      snapshot.top1MassShare,
      snapshot.top3MassShare,
      snapshot.top5MassShare,
      snapshot.top10MassShare,
      snapshot.oddsP10,
      snapshot.oddsMedian,
      snapshot.oddsP90,
      snapshot.oddsSpreadP90P10,
    ]);
    const transition = artifact.sequence.transitions[0];
    assert.deepEqual(row.values.slice(52, 63), [
      transition.jensenShannonDivergenceBits,
      transition.totalVariationDistance,
      transition.favoriteChanged ? 1 : 0,
      transition.top5RetainedCount,
      transition.top5ChurnRate,
      transition.medianAbsoluteLogOddsMove,
      transition.maxAbsoluteLogOddsMove,
      transition.massWeightedAbsoluteLogOddsMove,
      transition.shorteningSelectionCount,
      transition.lengtheningSelectionCount,
      transition.unchangedSelectionCount,
    ]);
  });
});

test("tampered or permission-widened referenced feature artifacts fail closed", () => {
  withRoot((root) => {
    const { manifestDigest, featurePath } = createManifest(root);
    const artifact = JSON.parse(readFileSync(featurePath, "utf8")) as any;
    artifact.sequence.snapshots[0].favoriteOdds += 1;
    writeFileSync(featurePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    assert.throws(
      () => buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest }),
      /EXPLORATION_MATRIX_FEATURE_ARTIFACT_INVALID/u,
    );
  });

  withRoot((root) => {
    const { manifestDigest, featurePath } = createManifest(root);
    chmodSync(featurePath, 0o644);
    assert.throws(
      () => buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest }),
      /EXPLORATION_MATRIX_FEATURE_FILE_MODE_INVALID/u,
    );
  });
});
