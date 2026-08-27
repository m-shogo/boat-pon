import assert from "node:assert/strict";
import test from "node:test";
import { resolveN2OddsTimeseriesStorageWindow } from "./n2OddsTimeseriesStorageWindow";

test("odds storage window accepts canonical Gregorian dates and leap day", () => {
  assert.deepEqual(resolveN2OddsTimeseriesStorageWindow("2028-02-28", "2028-03-01"), {
    from: "2028-02-28",
    to: "2028-03-01",
    dates: ["2028-02-28", "2028-02-29", "2028-03-01"],
  });
});

test("odds storage window rejects impossible and noncanonical dates", () => {
  for (const [from, to, code] of [
    ["2026-02-30", "2026-03-01", "N2_ODDS_STORAGE_FROM_INVALID"],
    ["2026-2-01", "2026-03-01", "N2_ODDS_STORAGE_FROM_INVALID"],
    ["2026-02-01", "2026-13-01", "N2_ODDS_STORAGE_TO_INVALID"],
    ["not-a-date", "2026-03-01", "N2_ODDS_STORAGE_FROM_INVALID"],
  ] as const) {
    assert.throws(() => resolveN2OddsTimeseriesStorageWindow(from, to), new RegExp(code));
  }
});

test("odds storage window rejects reversed ranges instead of emitting an empty audit", () => {
  assert.throws(
    () => resolveN2OddsTimeseriesStorageWindow("2026-07-02", "2026-07-01"),
    /N2_ODDS_STORAGE_WINDOW_REVERSED/u,
  );
});
