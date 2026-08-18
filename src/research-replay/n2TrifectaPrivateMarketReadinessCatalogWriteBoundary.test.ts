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
  canonicalReadinessCatalogGeneratedAt,
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

test("readiness catalog CLI time rejects values JavaScript Date would normalize", () => {
  for (const value of [
    "2026-08-19T24:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-08-19T12:00:00",
  ]) {
    assert.throws(
      () => canonicalReadinessCatalogGeneratedAt(value, "2026-08-19T00:00:00.000Z"),
      /READINESS_CATALOG_GENERATED_AT_INVALID/u,
    );
  }
});

test("readiness catalog CLI time canonicalizes valid explicit offsets and default now", () => {
  assert.equal(
    canonicalReadinessCatalogGeneratedAt(
      "2026-08-19T09:00:00+09:00",
      "2026-08-19T01:00:00.000Z",
    ),
    "2026-08-19T00:00:00.000Z",
  );
  assert.equal(
    canonicalReadinessCatalogGeneratedAt(null, "2026-08-19T01:00:00.000Z"),
    "2026-08-19T01:00:00.000Z",
  );
});

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
