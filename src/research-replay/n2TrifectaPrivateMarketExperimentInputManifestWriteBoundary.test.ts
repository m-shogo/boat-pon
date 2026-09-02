import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import { buildN2TrifectaPrivateMarketExperimentInputManifest } from
  "./n2TrifectaPrivateMarketExperimentInputManifest.js";
import { writeVerifiedN2TrifectaPrivateMarketExperimentInputManifest } from
  "./n2TrifectaPrivateMarketExperimentInputManifestWriteBoundary.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-experiment-manifest-write-boundary-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createNoDataDay(root: string): void {
  const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: root,
    date: "2026-08-07",
    venueCode: "10",
    generatedAt: "2026-08-07T03:30:00.000Z",
  });
  writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
}

test("verified manifest writer accepts the canonical source-bound snapshot", () => {
  withRoot((root) => {
    createNoDataDay(root);
    const manifest = buildN2TrifectaPrivateMarketExperimentInputManifest({
      rootDir: root,
      scopes: [{ date: "2026-08-07", venueCode: "10" }],
    });

    const result = writeVerifiedN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest });
    assert.equal(result.created, true);
    assert.equal(result.manifestDigest, manifest.manifestDigest);
  });
});

test("verified manifest writer rejects a rehashed caller-invented sourceAsOf", () => {
  withRoot((root) => {
    createNoDataDay(root);
    const canonical = buildN2TrifectaPrivateMarketExperimentInputManifest({
      rootDir: root,
      scopes: [{ date: "2026-08-07", venueCode: "10" }],
    });
    const { manifestDigest: _digest, ...core } = canonical;
    const forgedCore = {
      ...core,
      sourceAsOf: "2099-01-01T00:00:00.000Z",
    };
    const forged = {
      ...forgedCore,
      manifestDigest: canonicalHash(forgedCore),
    };

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest: forged }),
      /EXPERIMENT_INPUT_MANIFEST_WRITE_AUTHORITY_INVALID/u,
    );
  });
});
