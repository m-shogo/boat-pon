import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import { buildN2TrifectaPrivateMarketFeatureDayIndex } from
  "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import { writeVerifiedN2TrifectaPrivateMarketFeatureDayIndex } from
  "./n2TrifectaPrivateMarketFeatureDayIndexWriteBoundary.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-day-write-boundary-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("verified feature-day writer accepts the canonical rebuilt projection", () => {
  withRoot((root) => {
    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });

    const result = writeVerifiedN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    assert.equal(result.changed, true);
    assert.equal(result.indexDigest, index.indexDigest);
  });
});

test("verified feature-day writer rejects rehashed caller-invented readiness counts", () => {
  withRoot((root) => {
    const canonical = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:05:00.000Z",
    });
    const { indexDigest: _digest, ...core } = canonical;
    const forgedCore = {
      ...core,
      status: "PASS" as const,
      passCount: 12,
      partialCount: 0,
      noDataCount: 0,
    };
    const forged = {
      ...forgedCore,
      indexDigest: canonicalHash(forgedCore),
    };

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index: forged }),
      /PRIVATE_FEATURE_DAY_INDEX_WRITE_AUTHORITY_INVALID/u,
    );
  });
});
