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
import { buildN2TrifectaPrivateMarketDailyReadiness } from
  "./n2TrifectaPrivateMarketDailyReadiness.js";
import { writeVerifiedN2TrifectaPrivateMarketDailyReadiness } from
  "./n2TrifectaPrivateMarketDailyReadinessWriteBoundary.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-readiness-write-boundary-"));
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
    generatedAt: "2026-08-07T02:05:00.000Z",
  });
  writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
}

test("verified readiness writer accepts the canonical source-bound snapshot", () => {
  withRoot((root) => {
    createNoDataDay(root);
    const readiness = buildN2TrifectaPrivateMarketDailyReadiness({
      dataRoot: root,
      date: "2026-08-07",
      venueCode: "10",
      checkedAt: "2026-08-07T02:10:00.000Z",
    });

    const result = writeVerifiedN2TrifectaPrivateMarketDailyReadiness({ dataRoot: root, readiness });
    assert.equal(result.created, true);
    assert.equal(result.outputDigest, readiness.outputDigest);
  });
});

test("verified readiness writer rejects rehashed caller-invented complete-race counts", () => {
  withRoot((root) => {
    createNoDataDay(root);
    const canonical = buildN2TrifectaPrivateMarketDailyReadiness({
      dataRoot: root,
      date: "2026-08-07",
      venueCode: "10",
      checkedAt: "2026-08-07T02:10:00.000Z",
    });
    const { outputDigest: _digest, ...core } = canonical;
    const forgedCore = {
      ...core,
      completeRaceCount: 12,
    };
    const forged = {
      ...forgedCore,
      outputDigest: canonicalHash(forgedCore),
    };

    assert.throws(
      () => writeVerifiedN2TrifectaPrivateMarketDailyReadiness({ dataRoot: root, readiness: forged }),
      /DAILY_READINESS_WRITE_AUTHORITY_INVALID/u,
    );
  });
});
