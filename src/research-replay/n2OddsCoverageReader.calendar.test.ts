import assert from "node:assert/strict";
import test from "node:test";

import { readTrifectaMarketCoverageEvents } from "./n2OddsCoverageReader";

test("odds coverage rejects impossible calendar ranges before opening databases", () => {
  for (const [dateFrom, dateTo] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-04-31", "2026-05-01"],
    ["2026-08-01", "2026-02-30"],
  ] as const) {
    assert.throws(() => readTrifectaMarketCoverageEvents({
      primaryDbPath: "/does/not/exist-primary.sqlite",
      sidecarDbPath: "/does/not/exist-sidecar.sqlite",
      dateFrom,
      dateTo,
      checkpoint: "T-5",
    }), /N2_COVERAGE_INVALID_DATE_RANGE/);
  }
});
