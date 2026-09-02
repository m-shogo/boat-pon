import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketReadinessCatalog,
  writeN2TrifectaPrivateMarketReadinessCatalog,
  type N2TrifectaPrivateMarketReadinessCatalog,
  type N2TrifectaPrivateMarketReadinessCatalogEntry,
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

function entry(latestCheckedAt: string, scopeArtifactCount = 1): N2TrifectaPrivateMarketReadinessCatalogEntry {
  return {
    date: "2026-08-19",
    venueCode: "01",
    latestCheckedAt,
    readinessStatus: "NO_DATA",
    readinessDigest: "a".repeat(64),
    sourceDayIndexDigest: "b".repeat(64),
    sourceDayIndexStatus: "NO_DATA",
    completeRaceCount: 0,
    partialRaceCount: 0,
    noDataRaceCount: 12,
    cohortCandidateRaceCount: 0,
    checkpointCoverageNumerator: 0,
    checkpointCoverageDenominator: 48,
    checkpointCoverageRatio: 0,
    heartbeatStatus: "PASS",
    heartbeatSignificantGapCount: 0,
    heartbeatAffectedCheckpointCount: 0,
    heartbeatCurrentGapOverThreshold: false,
    heartbeatPlanStatus: "PASS",
    scopeArtifactCount,
  };
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

test("rehashed producer with noncanonical scope timestamp fails closed before persistence", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    catalog.entries = [entry("not-an-instant")];
    catalog.sourceArtifactCount = 1;
    catalog.entryCount = 1;
    catalog.earliestDate = "2026-08-19";
    catalog.latestDate = "2026-08-19";
    rehash(catalog);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_SCOPE_AUTHORITY_INVALID/u,
    );
  });
});

test("rehashed producer cannot detach scope date from checked-at JST date", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const mismatched = entry("2026-08-19T15:30:00.000Z");
    mismatched.date = "2026-08-19";
    catalog.entries = [mismatched];
    catalog.sourceArtifactCount = 1;
    catalog.entryCount = 1;
    catalog.earliestDate = "2026-08-19";
    catalog.latestDate = "2026-08-19";
    rehash(catalog);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_SCOPE_AUTHORITY_INVALID/u,
    );
  });
});

test("rehashed producer cannot use a calendar-impossible scope date", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const impossible = entry("2026-03-01T00:00:00.000Z");
    impossible.date = "2026-02-30";
    catalog.entries = [impossible];
    catalog.sourceArtifactCount = 1;
    catalog.entryCount = 1;
    catalog.earliestDate = "2026-02-30";
    catalog.latestDate = "2026-02-30";
    rehash(catalog);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_SCOPE_AUTHORITY_INVALID/u,
    );
  });
});

test("rehashed producer cannot detach source artifact count from scope totals", () => {
  withRoot((root) => {
    const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    catalog.entries = [entry("2026-08-19T00:00:00.000Z", 2)];
    catalog.sourceArtifactCount = 1;
    catalog.entryCount = 1;
    catalog.earliestDate = "2026-08-19";
    catalog.latestDate = "2026-08-19";
    rehash(catalog);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog }),
      /READINESS_CATALOG_WRITE_SCOPE_AUTHORITY_INVALID/u,
    );
  });
});

test("digest-valid existing catalog cannot be replaced by lower append-only evidence count", () => {
  withRoot((root) => {
    const existing = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    existing.entries = [entry("2026-08-19T00:00:00.000Z", 2)];
    existing.sourceArtifactCount = 2;
    existing.entryCount = 1;
    existing.earliestDate = "2026-08-19";
    existing.latestDate = "2026-08-19";
    rehash(existing);
    const first = writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog: existing });
    assert.equal(first.changed, true);

    const regressed = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:10:00.000Z",
    });
    regressed.entries = [entry("2026-08-19T00:05:00.000Z", 1)];
    regressed.sourceArtifactCount = 1;
    regressed.entryCount = 1;
    regressed.earliestDate = "2026-08-19";
    regressed.latestDate = "2026-08-19";
    rehash(regressed);
    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog: regressed }),
      /READINESS_CATALOG_APPEND_ONLY_REGRESSION/u,
    );
  });
});

test("digest-valid existing catalog with noncanonical scope timestamp is not trusted as append-only authority", () => {
  withRoot((root) => {
    const existing = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    existing.entries = [entry("not-an-instant")];
    existing.sourceArtifactCount = 1;
    existing.entryCount = 1;
    existing.earliestDate = "2026-08-19";
    existing.latestDate = "2026-08-19";
    rehash(existing);
    const first = writeN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog: existing });
    assert.equal(first.changed, true);

    const next = buildN2TrifectaPrivateMarketReadinessCatalog({
      dataRoot: root,
      generatedAt: "2026-08-19T00:10:00.000Z",
    });
    next.entries = [entry("2026-08-19T00:05:00.000Z")];
    next.sourceArtifactCount = 1;
    next.entryCount = 1;
    next.earliestDate = "2026-08-19";
    next.latestDate = "2026-08-19";
    rehash(next);

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot: root, catalog: next }),
      /READINESS_CATALOG_EXISTING_AUTHORITY_INVALID/u,
    );
  });
});
