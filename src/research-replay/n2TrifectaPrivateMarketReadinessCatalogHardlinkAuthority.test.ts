import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildN2TrifectaPrivateMarketReadinessCatalog } from "./n2TrifectaPrivateMarketReadinessCatalog.js";

test("readiness catalog rejects hardlinked private readiness artifacts before parsing", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-hardlink-"));
  const aliasRoot = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-hardlink-alias-"));
  try {
    const digest = "a".repeat(64);
    const venueDir = join(root, "data/private/trifecta-market-experiments/readiness/2026-09-04/01");
    mkdirSync(venueDir, { recursive: true, mode: 0o700 });
    const artifactPath = join(venueDir, `${digest}.json`);
    writeFileSync(artifactPath, "{}\n", { mode: 0o600 });
    chmodSync(artifactPath, 0o600);
    linkSync(artifactPath, join(aliasRoot, "artifact-alias.json"));

    assert.throws(
      () => buildN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, generatedAt: "2026-09-04T00:00:00.000Z" }),
      /READINESS_CATALOG_ARTIFACT_FILE_HARDLINK_NOT_ALLOWED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(aliasRoot, { recursive: true, force: true });
  }
});
