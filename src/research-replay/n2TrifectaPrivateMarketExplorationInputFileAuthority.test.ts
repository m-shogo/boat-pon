import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertN2TrifectaPrivateMarketExplorationInputSingleLinks } from
  "./n2TrifectaPrivateMarketExplorationInputFileAuthority.js";

const manifestDigest = "a".repeat(64);
const featureRelativePath = "data/private/trifecta-market-features/2026-08-07/10/04.json";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-exploration-input-authority-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeInputs(root: string): { manifestPath: string; featurePath: string } {
  const featurePath = join(root, featureRelativePath);
  mkdirSync(dirname(featurePath), { recursive: true, mode: 0o700 });
  writeFileSync(featurePath, "{}\n", { encoding: "utf8", mode: 0o600 });

  const manifestPath = join(
    root,
    "data/private/trifecta-market-experiments/manifests",
    `${manifestDigest}.json`,
  );
  mkdirSync(dirname(manifestPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ races: [{ featureArtifactRelativePath: featureRelativePath }] })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { manifestPath, featurePath };
}

test("accepts single-link exploration manifest and feature inputs", () => {
  withRoot((root) => {
    writeInputs(root);
    assert.doesNotThrow(() =>
      assertN2TrifectaPrivateMarketExplorationInputSingleLinks(root, manifestDigest));
  });
});

test("rejects a hardlinked exploration manifest before parsing feature authority", () => {
  withRoot((root) => {
    const { manifestPath } = writeInputs(root);
    linkSync(manifestPath, `${manifestPath}.alias`);
    assert.throws(
      () => assertN2TrifectaPrivateMarketExplorationInputSingleLinks(root, manifestDigest),
      /EXPLORATION_MATRIX_MANIFEST_HARDLINK_NOT_ALLOWED/u,
    );
  });
});

test("rejects a hardlinked feature artifact referenced by the exploration manifest", () => {
  withRoot((root) => {
    const { featurePath } = writeInputs(root);
    linkSync(featurePath, `${featurePath}.alias`);
    assert.throws(
      () => assertN2TrifectaPrivateMarketExplorationInputSingleLinks(root, manifestDigest),
      /EXPLORATION_MATRIX_FEATURE_HARDLINK_NOT_ALLOWED/u,
    );
  });
});
