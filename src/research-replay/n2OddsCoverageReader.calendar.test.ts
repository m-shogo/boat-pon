import assert from "node:assert/strict";
import test from "node:test";

import { isExplicitMarketObservedAt, readTrifectaMarketCoverageEvents } from "./n2OddsCoverageReader";

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

test("market observedAt requires a real calendar date, valid clock, and explicit timezone", () => {
  for (const value of [
    "2026-02-30T02:55:00Z",
    "2026-05-20T24:00:00Z",
    "2026-05-20T23:60:00Z",
    "2026-05-20T23:59:60Z",
    "2026-05-20T02:55:00",
  ]) {
    assert.equal(isExplicitMarketObservedAt(value), false, value);
  }

  assert.equal(isExplicitMarketObservedAt("2024-02-29T02:55:00Z"), true);
  assert.equal(isExplicitMarketObservedAt("2026-05-20T11:55:00+09:00"), true);
});
