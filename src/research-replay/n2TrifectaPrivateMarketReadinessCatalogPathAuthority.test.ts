import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildN2TrifectaPrivateMarketReadinessCatalog,
  writeN2TrifectaPrivateMarketReadinessCatalog,
} from "./n2TrifectaPrivateMarketReadinessCatalog.js";

test("readiness catalog writer rejects a symlinked ancestor before writing outside data root", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-external-"));
  try {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-07T03:30:00.000Z",
    });
    const privateRoot = join(root, "data/private");
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    symlinkSync(external, join(privateRoot, "trifecta-market-experiments"), "dir");

    assert.throws(
      () => writeN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_PARENT_INVALID/u,
    );
    assert.equal(existsSync(join(external, "readiness/catalog.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
