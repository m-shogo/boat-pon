import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildN2TrifectaPrivateMarketFeatureDayIndex } from "./n2TrifectaPrivateMarketFeatureDayIndex.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-feature-day-index-date-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("day index rejects impossible race dates before creating a NO_DATA authority", () => {
  withRoot((root) => {
    for (const date of ["2026-02-30", "2026-04-31", "2025-02-29"]) {
      assert.throws(
        () => buildN2TrifectaPrivateMarketFeatureDayIndex({
          rootDir: root,
          date,
          venueCode: "10",
          generatedAt: "2026-08-07T02:05:00.000Z",
        }),
        /PRIVATE_FEATURE_DAY_INDEX_DATE_INVALID/u,
        date,
      );
    }

    const leapDay = buildN2TrifectaPrivateMarketFeatureDayIndex({
      rootDir: root,
      date: "2028-02-29",
      venueCode: "10",
      generatedAt: "2028-02-29T02:05:00.000Z",
    });
    assert.equal(leapDay.status, "NO_DATA");
    assert.equal(leapDay.noDataCount, 12);
  });
});
