import assert from "node:assert/strict";
import { linkSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
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
import { writeVerifiedN2TrifectaPrivateMarketExplorationMatrix } from
  "./n2TrifectaPrivateMarketExplorationMatrixWriteBoundary.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-exploration-matrix-write-boundary-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createEmptyManifest(root: string): string {
  const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: root,
    date: "2026-08-07",
    venueCode: "10",
    generatedAt: "2026-08-07T03:30:00.000Z",
  });
  writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
  const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({
    rootDir: root,
    scopes: [{ date: "2026-08-07", venueCode: "10" }],
  });
  writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest });
  return manifest.manifestDigest;
}

test("verified exploration-matrix writer accepts the canonical source-bound matrix", () => {
  withRoot((root) => {
    const manifestDigest = createEmptyManifest(root);
    const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });

    const result = writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix });
    assert.equal(result.created, true);
    assert.equal(result.matrixDigest, matrix.matrixDigest);
  });
});

test("verified exploration-matrix writer rejects hardlinked source manifest before rebuild", () => {
  withRoot((root) => {
    const manifestDigest = createEmptyManifest(root);
    const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });
    const manifestPath = join(
      root,
      "data/private/trifecta-market-experiments/manifests",
      `${manifestDigest}.json`,
    );
    linkSync(manifestPath, `${manifestPath}.alias`);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix }),
      /EXPLORATION_MATRIX_MANIFEST_HARDLINK_NOT_ALLOWED/u,
    );
  });
});

test("verified exploration-matrix writer rejects symlinked matrix ancestors before persistence", () => {
  withRoot((root) => {
    const external = mkdtempSync(join(tmpdir(), "boat-pon-exploration-matrix-external-"));
    try {
      const manifestDigest = createEmptyManifest(root);
      const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });
      symlinkSync(external, join(root, "data/private/trifecta-market-experiments/matrices"), "dir");

      assert.throws(
        () => writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix }),
        /EXPLORATION_MATRIX_PARENT_INVALID/u,
      );
      assert.deepEqual(readdirSync(external), []);
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });
});

test("verified exploration-matrix writer rejects hardlinked existing matrix reuse", () => {
  withRoot((root) => {
    const manifestDigest = createEmptyManifest(root);
    const matrix = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });
    const first = writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix });
    const path = join(root, first.relativePath);
    linkSync(path, `${path}.alias`);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix }),
      /EXPLORATION_MATRIX_EXISTING_HARDLINK_NOT_ALLOWED/u,
    );
  });
});

test("verified exploration-matrix writer rejects rehashed caller-invented race counts", () => {
  withRoot((root) => {
    const manifestDigest = createEmptyManifest(root);
    const canonical = buildN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, manifestDigest });
    assert.equal(canonical.raceCount, 0);
    const { matrixDigest: _digest, ...core } = canonical;
    const forgedCore = {
      ...core,
      raceCount: 1,
    };
    const forged = {
      ...forgedCore,
      matrixDigest: canonicalHash(forgedCore),
    };

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketExplorationMatrix({ rootDir: root, matrix: forged }),
      /EXPLORATION_MATRIX_WRITE_AUTHORITY_INVALID/u,
    );
  });
});
