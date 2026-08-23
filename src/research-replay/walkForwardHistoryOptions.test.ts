import assert from "node:assert/strict";
import test from "node:test";

import { parseWalkForwardHistoryOptions } from "./walkForwardHistoryOptions";

test("walk-forward accepts canonical filters", () => {
  assert.deepEqual(
    parseWalkForwardHistoryOptions([
      "--", "--from", "2028-02-29", "--to", "2028-03-31",
      "--window-days", "30", "--step-days", "7", "--min-buys", "5", "--json",
    ]),
    { from: "2028-02-29", to: "2028-03-31", windowDays: 30, stepDays: 7, minBuys: 5, json: true },
  );
});

test("walk-forward preserves defaults", () => {
  assert.deepEqual(
    parseWalkForwardHistoryOptions([]),
    { from: null, to: null, windowDays: 30, stepDays: 7, minBuys: 5, json: false },
  );
});

test("walk-forward rejects impossible and non-canonical dates", () => {
  for (const [flag, value] of [
    ["--from", "2026-02-30"],
    ["--from", "2026-6-01"],
    ["--to", "2026-08-32"],
    ["--to", "2026-08-23T00:00:00Z"],
  ] as const) {
    assert.throws(() => parseWalkForwardHistoryOptions([flag, value]), /WALK_FORWARD_(FROM|TO)_INVALID/u);
  }
});

test("walk-forward rejects reversed date ranges", () => {
  assert.throws(
    () => parseWalkForwardHistoryOptions(["--from", "2026-08-24", "--to", "2026-08-23"]),
    /WALK_FORWARD_DATE_RANGE_INVALID/u,
  );
});

test("walk-forward rejects invalid numeric controls", () => {
  for (const flag of ["--window-days", "--step-days", "--min-buys"] as const) {
    for (const value of ["0", "-1", "1.5", "NaN", "01", String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(() => parseWalkForwardHistoryOptions([flag, value]), /WALK_FORWARD_(WINDOW_DAYS|STEP_DAYS|MIN_BUYS)_INVALID/u);
    }
  }
});

test("walk-forward rejects missing, unknown, and duplicate arguments", () => {
  assert.throws(() => parseWalkForwardHistoryOptions(["--window-days"]), /ARGUMENT_MISSING/u);
  assert.throws(() => parseWalkForwardHistoryOptions(["--unknown", "x"]), /ARGUMENT_INVALID/u);
  assert.throws(
    () => parseWalkForwardHistoryOptions(["--step-days", "7", "--step-days", "14"]),
    /ARGUMENT_DUPLICATE/u,
  );
  assert.throws(() => parseWalkForwardHistoryOptions(["--json", "--json"]), /ARGUMENT_DUPLICATE/u);
});
