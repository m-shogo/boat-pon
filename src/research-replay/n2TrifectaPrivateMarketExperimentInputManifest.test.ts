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
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { writeN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import {
  N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION,
  buildN2TrifectaPrivateMarketExperimentInputManifest,
  writeN2TrifectaPrivateMarketExperimentInputManifest,
} from "./n2TrifectaPrivateMarketExperimentInputManifest.js";

const checkpoints = ["T-30", "T-20", "T-10", "T-5"] as const;

function report(input: {
  date: string;
  venueCode: string;
  raceNo: number;
  status: "PASS" | "PARTIAL";
  availableCount: number;
}): N2TrifectaPrivateMarketFeatureLoadReport {
  const available = checkpoints.slice(0, input.availableCount);
  const missing = checkpoints.slice(input.availableCount);
  const raceIdentity = `${input.date.replaceAll("-", "")}-${input.venueCode}-${String(input.raceNo).padStart(2, "0")}`;
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: input.status,
    blockers: [],
    date: input.date,
    venueCode: input.venueCode,
    raceNo: input.raceNo,
    raceIdentity,
    acceptedMarkerCount: available.length,
    loadedSnapshotCount: available.length,
    sequence: {
      featureVersion: "n2-trifecta-market-features-v1",
      status: input.status,
      raceIdentity,
      availableCheckpoints: [...available],
      missingCheckpoints: [...missing],
      snapshots: available.map((checkpointLabel, index) => ({ checkpointLabel, index })),
      transitions: available.slice(1).map((checkpointLabel, index) => ({
        fromCheckpointLabel: available[index],
        toCheckpointLabel: checkpointLabel,
      })),
    } as unknown as N2TrifectaPrivateMarketFeatureLoadReport["sequence"],
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: `${input.date.replaceAll("-", "")}${input.venueCode}${String(input.raceNo).padStart(2, "0")}`
      .padStart(64, "0")
      .slice(-64)
      .replace(/[^0-9a-f]/gu, "a"),
  };
}

function createDay(input: {
  root: string;
  date: string;
  venueCode: string;
  passRaces: number[];
  partialRaces?: number[];
  generatedAt: string;
}): void {
  for (const raceNo of input.passRaces) {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: input.root,
      report: report({
        date: input.date,
        venueCode: input.venueCode,
        raceNo,
        status: "PASS",
        availableCount: 4,
      }),
      generatedAt: input.generatedAt,
    });
  }
  for (const raceNo of input.partialRaces ?? []) {
    writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: input.root,
      report: report({
        date: input.date,
        venueCode: input.venueCode,
        raceNo,
        status: "PARTIAL",
        availableCount: 2,
      }),
      generatedAt: input.generatedAt,
    });
  }
  const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: input.root,
    date: input.date,
    venueCode: input.venueCode,
    generatedAt: input.generatedAt,
  });
  writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: input.root, index });
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-experiment-input-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("manifest deterministically selects only full-trajectory PASS races from explicit day indices", () => {
  withRoot((root) => {
    createDay({
      root,
      date: "2026-08-07",
      venueCode: "10",
      passRaces: [4, 6, 7],
      partialRaces: [2, 5],
      generatedAt: "2026-08-07T03:30:00.000Z",
    });
    createDay({
      root,
      date: "2026-08-08",
      venueCode: "10",
      passRaces: [1, 2],
      partialRaces: [3],
      generatedAt: "2026-08-08T03:30:00.000Z",
    });

    const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({
      rootDir: root,
      scopes: [
        { date: "2026-08-08", venueCode: "10" },
        { date: "2026-08-07", venueCode: "10" },
      ],
    });

    assert.equal(manifest.manifestVersion, N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION);
    assert.equal(manifest.evidenceRole, "EXPLORATION_ONLY");
    assert.equal(manifest.coveragePolicy, "FULL_TRAJECTORY_ONLY");
    assert.equal(manifest.labelPolicy, "NO_OUTCOME_LABELS");
    assert.equal(manifest.selectionPolicy, "ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES");
    assert.equal(manifest.sourceAsOf, "2026-08-08T03:30:00.000Z");
    assert.deepEqual(
      manifest.sourceIndices.map((source) => `${source.date}|${source.venueCode}`),
      ["2026-08-07|10", "2026-08-08|10"],
    );
    assert.deepEqual(
      manifest.races.map((race) => race.raceIdentity),
      [
        "20260807-10-04",
        "20260807-10-06",
        "20260807-10-07",
        "20260808-10-01",
        "20260808-10-02",
      ],
    );
    assert.equal(manifest.raceCount, 5);
    assert.ok(manifest.races.every((race) => race.checkpointCoverage.length === 4));
    assert.equal(manifest.outcomeDataRead, false);
    assert.equal(manifest.holdoutDataRead, false);
    assert.equal(manifest.validationDataRead, false);
    assert.equal(manifest.rawCaptureEvidenceRead, false);
    assert.equal(manifest.rawOddsValuesPublished, false);
    assert.equal(manifest.databaseReadCount, 0);
    assert.equal(manifest.networkRequestCount, 0);
    assert.equal(manifest.currentBuyConnectionAuthorized, false);
    assert.equal(manifest.lineConnectionAuthorized, false);
    assert.equal(manifest.automatedBettingAuthorized, false);
    assert.equal(manifest.productionApplyAuthorized, false);

    const reversed = buildN2TrifectaPrivateMarketExperimentInputManifest({
      rootDir: root,
      scopes: [
        { date: "2026-08-07", venueCode: "10" },
        { date: "2026-08-08", venueCode: "10" },
      ],
    });
    assert.equal(reversed.manifestDigest, manifest.manifestDigest);

    const write = writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest });
    assert.equal(write.created, true);
    assert.equal(statSync(join(root, write.relativePath)).mode & 0o777, 0o600);
    const second = writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest });
    assert.equal(second.created, false);
  });
});

test("partial and no-data races never enter the exploration input cohort", () => {
  withRoot((root) => {
    createDay({
      root,
      date: "2026-08-07",
      venueCode: "10",
      passRaces: [],
      partialRaces: [1, 2, 3],
      generatedAt: "2026-08-07T03:30:00.000Z",
    });
    const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({
      rootDir: root,
      scopes: [{ date: "2026-08-07", venueCode: "10" }],
    });
    assert.equal(manifest.raceCount, 0);
    assert.deepEqual(manifest.races, []);
    assert.equal(manifest.sourceIndices[0]?.partialCount, 3);
    assert.equal(manifest.sourceIndices[0]?.passCount, 0);
  });
});

test("tampered or permission-widened day indices fail closed before cohort assembly", () => {
  withRoot((root) => {
    createDay({
      root,
      date: "2026-08-07",
      venueCode: "10",
      passRaces: [4],
      generatedAt: "2026-08-07T03:30:00.000Z",
    });
    const path = join(root, "data/private/trifecta-market-features/2026-08-07/10/index.json");
    const index = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    index.publicPublishAuthorized = true;
    writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    assert.throws(
      () => buildN2TrifectaPrivateMarketExperimentInputManifest({
        rootDir: root,
        scopes: [{ date: "2026-08-07", venueCode: "10" }],
      }),
      /DAY_INDEX_PROTECTED_BOUNDARY_INVALID/u,
    );

    index.publicPublishAuthorized = false;
    writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    chmodSync(path, 0o644);
    assert.throws(
      () => buildN2TrifectaPrivateMarketExperimentInputManifest({
        rootDir: root,
        scopes: [{ date: "2026-08-07", venueCode: "10" }],
      }),
      /DAY_INDEX_FILE_MODE_INVALID/u,
    );
  });
});

test("rehashed non-canonical day index times fail closed before manifest lineage assembly", () => {
  withRoot((root) => {
    createDay({
      root,
      date: "2026-08-07",
      venueCode: "10",
      passRaces: [4],
      generatedAt: "2026-08-07T03:30:00.000Z",
    });
    const path = join(root, "data/private/trifecta-market-features/2026-08-07/10/index.json");
    const index = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    for (const generatedAt of [
      "2026-08-06T27:30:00.000Z",
      "2026-08-07T12:30:00.000+09:00",
      "2026-08-07T03:30:00",
    ]) {
      const tampered: Record<string, unknown> = { ...index, generatedAt };
      const { indexDigest: _indexDigest, ...core } = tampered;
      tampered.indexDigest = canonicalHash(core);
      writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
      assert.throws(
        () => buildN2TrifectaPrivateMarketExperimentInputManifest({
          rootDir: root,
          scopes: [{ date: "2026-08-07", venueCode: "10" }],
        }),
        /DAY_INDEX_GENERATED_AT_INVALID/u,
        generatedAt,
      );
    }
  });
});

test("impossible scope dates fail closed before private day index lookup", () => {
  withRoot((root) => {
    assert.throws(
      () => buildN2TrifectaPrivateMarketExperimentInputManifest({
        rootDir: root,
        scopes: [{ date: "2026-02-30", venueCode: "10" }],
      }),
      /EXPERIMENT_INPUT_DATE_INVALID/u,
    );
    assert.throws(
      () => buildN2TrifectaPrivateMarketExperimentInputManifest({
        rootDir: root,
        scopes: [{ date: "2028-02-29", venueCode: "10" }],
      }),
      /DAY_INDEX_MISSING:2028-02-29:10/u,
    );
  });
});
