import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  writeN2TrifectaPrivateMarketExperimentInputManifest,
  type N2TrifectaPrivateMarketExperimentInputManifest,
} from "./n2TrifectaPrivateMarketExperimentInputManifest.js";

test("experiment manifest writer rejects a symlinked ancestor before writing outside root", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-experiment-manifest-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-experiment-manifest-external-"));
  try {
    mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
    symlinkSync(external, join(root, "data/private/trifecta-market-experiments"), "dir");

    const digest = "a".repeat(64);
    const manifest = { manifestDigest: digest } as unknown as N2TrifectaPrivateMarketExperimentInputManifest;
    assert.throws(
      () => writeN2TrifectaPrivateMarketExperimentInputManifest({ rootDir: root, manifest }),
      /EXPERIMENT_INPUT_MANIFEST_PARENT_INVALID/u,
    );
    assert.equal(existsSync(join(external, "manifests", `${digest}.json`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
