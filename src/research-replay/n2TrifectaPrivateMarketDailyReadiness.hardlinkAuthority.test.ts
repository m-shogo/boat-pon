import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex.js";
import { buildN2TrifectaPrivateMarketDailyReadiness } from "./n2TrifectaPrivateMarketDailyReadiness.js";

test("daily readiness rejects a valid day index that has a hardlink alias", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-day-index-hardlink-"));
  try {
    const index = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2026-08-07",
      venueCode: "10",
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const written = writeN2TrifectaPrivateMarketFeatureDayIndex({ rootDir: root, index });
    const canonicalPath = join(root, written.relativePath);
    linkSync(canonicalPath, join(root, "day-index-alias.json"));

    assert.throws(
      () => buildN2TrifectaPrivateMarketDailyReadiness({
        dataRoot: root,
        date: "2026-08-07",
        venueCode: "10",
        checkedAt: "2026-08-07T03:00:00.000Z",
      }),
      /DAILY_READINESS_DAY_INDEX_HARDLINK_NOT_ALLOWED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
