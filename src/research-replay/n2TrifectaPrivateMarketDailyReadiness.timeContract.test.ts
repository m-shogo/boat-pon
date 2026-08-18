import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildN2TrifectaPrivateMarketDailyReadiness } from "./n2TrifectaPrivateMarketDailyReadiness.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-daily-readiness-time-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("daily readiness rejects normalized checkedAt values before reading the day index", () => {
  withRoot((root) => {
    for (const checkedAt of [
      "2026-08-06T24:00:00.000Z",
      "2026-02-30T02:10:00.000Z",
      "2026-08-07T02:10:00",
    ]) {
      assert.throws(
        () => buildN2TrifectaPrivateMarketDailyReadiness({
          dataRoot: root,
          date: "2026-08-07",
          venueCode: "10",
          checkedAt,
        }),
        /DAILY_READINESS_CHECKED_AT_INVALID/u,
        checkedAt,
      );
    }
  });
});
