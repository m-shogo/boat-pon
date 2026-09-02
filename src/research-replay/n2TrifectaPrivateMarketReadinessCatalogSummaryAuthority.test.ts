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
import { writeVerifiedN2TrifectaPrivateMarketReadinessCatalog } from "./n2TrifectaPrivateMarketReadinessCatalogWriteBoundary";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-summary-authority-"));
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

test("rehashed producer cannot invent full-coverage scope summary", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    assert.equal(catalog.entryCount, 0);
    catalog.fullCoverageScopeCount = 1;
    rehash(catalog);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_SUMMARY_AUTHORITY_INVALID/u,
    );
  });
});

test("rehashed producer cannot invent date-range summary without scopes", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    assert.equal(catalog.entryCount, 0);
    catalog.earliestDate = "2026-08-19";
    catalog.latestDate = "2026-08-19";
    rehash(catalog);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_SUMMARY_AUTHORITY_INVALID/u,
    );
  });
});
