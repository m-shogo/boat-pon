import assert from "node:assert/strict";
import test from "node:test";

import { parseRollingReportOptions } from "./rollingReportOptions";

test("rolling report accepts canonical dates, days, separator, and json", () => {
  assert.deepEqual(
    parseRollingReportOptions(["--", "--from", "2028-02-29", "--to", "2028-03-01", "--days", "14", "--json"], 30),
    { from: "2028-02-29", to: "2028-03-01", days: 14, json: true },
  );
});

test("rolling report uses the caller default days", () => {
  assert.deepEqual(parseRollingReportOptions([], 30), { from: null, to: null, days: 30, json: false });
});

test("rolling report rejects impossible or non-canonical dates", () => {
  for (const [flag, value] of [
    ["--from", "2026-02-30"],
    ["--from", "2026-6-01"],
    ["--to", "2026-08-32"],
    ["--to", "2026-08-23T00:00:00Z"],
  ] as const) {
    assert.throws(() => parseRollingReportOptions([flag, value], 30), /ROLLING_REPORT_(FROM|TO)_INVALID/u);
  }
});

test("rolling report rejects reversed ranges", () => {
  assert.throws(
    () => parseRollingReportOptions(["--from", "2026-08-24", "--to", "2026-08-23"], 30),
    /ROLLING_REPORT_DATE_RANGE_INVALID/u,
  );
});

test("rolling report rejects invalid day windows", () => {
  for (const value of ["0", "-1", "1.5", "NaN", "01", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(() => parseRollingReportOptions(["--days", value], 30), /ROLLING_REPORT_DAYS_INVALID/u);
  }
});

test("rolling report rejects missing, unknown, and duplicate arguments", () => {
  assert.throws(() => parseRollingReportOptions(["--days"], 30), /ARGUMENT_MISSING/u);
  assert.throws(() => parseRollingReportOptions(["--unknown", "x"], 30), /ARGUMENT_INVALID/u);
  assert.throws(
    () => parseRollingReportOptions(["--from", "2026-08-01", "--from", "2026-08-02"], 30),
    /ARGUMENT_DUPLICATE/u,
  );
  assert.throws(() => parseRollingReportOptions(["--json", "--json"], 30), /ARGUMENT_DUPLICATE/u);
});
