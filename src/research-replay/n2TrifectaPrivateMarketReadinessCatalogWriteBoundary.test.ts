import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketReadinessCatalog,
  type N2TrifectaPrivateMarketReadinessCatalog,
} from "./n2TrifectaPrivateMarketReadinessCatalog";
import {
  writeVerifiedN2TrifectaPrivateMarketReadinessCatalog,
} from "./n2TrifectaPrivateMarketReadinessCatalogWriteBoundary";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-catalog-write-boundary-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rehash(catalog: N2TrifectaPrivateMarketReadinessCatalog): void {
  const record = catalog as unknown as Record<string, unknown>;
  const { catalogDigest: _catalogDigest, ...core } = record;
  record.catalogDigest = canonicalHash(core);
}

test("valid producer catalog remains writable", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const result = writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog });
    assert.equal(result.changed, true);
  });
});

test("rehashed authority-widened catalog fails closed before persistence", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const record = catalog as unknown as Record<string, unknown>;
    record.currentBuyConnectionAuthorized = true;
    rehash(catalog);
    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_PROTECTED_BOUNDARY_INVALID/u,
    );
  });
});

test("rehashed writer with non-read-only provenance fails closed", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const record = catalog as unknown as Record<string, unknown>;
    record.databaseWriteCount = 1;
    rehash(catalog);
    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_PROTECTED_BOUNDARY_INVALID/u,
    );
  });
});
