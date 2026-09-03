import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION,
  privateMarketExperimentInputManifestRelativePath,
  writeN2TrifectaPrivateMarketExperimentInputManifest,
  type N2TrifectaPrivateMarketExperimentInputManifest,
} from "./n2TrifectaPrivateMarketExperimentInputManifest.js";

function fixtureManifest(): N2TrifectaPrivateMarketExperimentInputManifest {
  return {
    manifestVersion: N2_TRIFECTA_PRIVATE_MARKET_EXPERIMENT_INPUT_MANIFEST_VERSION,
    evidenceRole: "EXPLORATION_ONLY",
    coveragePolicy: "FULL_TRAJECTORY_ONLY",
    labelPolicy: "NO_OUTCOME_LABELS",
    selectionPolicy: "ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES",
    sourceAsOf: "2026-08-01T00:00:00.000Z",
    sourceIndices: [],
    raceCount: 0,
    races: [],
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawCaptureEvidenceRead: false,
    rawOddsValuesPublished: false,
    outcomeDataRead: false,
    holdoutDataRead: false,
    validationDataRead: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
    manifestDigest: "a".repeat(64),
  };
}

test("existing experiment manifest hardlinks are rejected instead of reused", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "boat-pon-experiment-manifest-hardlink-"));
  try {
    const manifest = fixtureManifest();
    const first = writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir, manifest });
    assert.equal(first.created, true);

    const manifestPath = resolve(rootDir, privateMarketExperimentInputManifestRelativePath(manifest.manifestDigest));
    const aliasPath = join(dirname(manifestPath), "manifest-hardlink-alias.json");
    linkSync(manifestPath, aliasPath);

    assert.throws(
      () => writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir, manifest }),
      /EXPERIMENT_INPUT_MANIFEST_FILE_HARDLINK_NOT_ALLOWED/u,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
