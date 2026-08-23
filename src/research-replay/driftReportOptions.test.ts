import assert from "node:assert/strict";
import test from "node:test";

import { parseDriftReportOptions } from "./driftReportOptions";

const TODAY = "2026-08-23";

test("drift report accepts canonical windows and filters", () => {
  assert.deepEqual(
    parseDriftReportOptions([
      "--",
      "--baseline-from", "2025-01-01", "--baseline-to", "2025-06-01",
      "--recent-from", "2026-01-01", "--recent-to", "2026-06-01",
      "--rule-id", "wind24-exh1-switch", "--condition", "venue=桐生",
      "--json", "--presentation-json",
    ], TODAY),
    {
      baselineFrom: "2025-01-01",
      baselineTo: "2025-06-01",
      recentFrom: "2026-01-01",
      recentTo: "2026-06-01",
      ruleId: "wind24-exh1-switch",
      condition: { key: "venue", value: "桐生" },
      json: true,
      presentationJson: true,
    },
  );
});

test("drift report preserves existing defaults", () => {
  assert.deepEqual(parseDriftReportOptions([], TODAY), {
    baselineFrom: "1970-01-01",
    baselineTo: "1970-01-01",
    recentFrom: "1970-01-01",
    recentTo: TODAY,
    ruleId: "detect-drift-adhoc",
    json: false,
    presentationJson: false,
    condition: undefined,
  });
});

test("drift report rejects impossible and non-canonical dates", () => {
  for (const [flag, value] of [
    ["--baseline-from", "2026-02-30"],
    ["--baseline-to", "2026-6-01"],
    ["--recent-from", "2026-08-32"],
    ["--recent-to", "2026-08-23T00:00:00Z"],
  ] as const) {
    assert.throws(() => parseDriftReportOptions([flag, value], TODAY), /DRIFT_REPORT_.*_INVALID/u);
  }
});

test("drift report rejects reversed baseline and recent ranges", () => {
  assert.throws(
    () => parseDriftReportOptions(["--baseline-from", "2026-02-01", "--baseline-to", "2026-01-01"], TODAY),
    /DRIFT_REPORT_BASELINE_RANGE_INVALID/u,
  );
  assert.throws(
    () => parseDriftReportOptions(["--recent-from", "2026-08-24", "--recent-to", "2026-08-23"], TODAY),
    /DRIFT_REPORT_RECENT_RANGE_INVALID/u,
  );
});

test("drift report rejects blank or padded rule identity", () => {
  for (const value of ["", " ", " rule-a", "rule-a "]) {
    assert.throws(() => parseDriftReportOptions(["--rule-id", value], TODAY), /DRIFT_REPORT_RULE_ID_INVALID/u);
  }
});

test("drift report rejects missing, unknown, and duplicate arguments", () => {
  assert.throws(() => parseDriftReportOptions(["--baseline-from"], TODAY), /ARGUMENT_MISSING/u);
  assert.throws(() => parseDriftReportOptions(["--unknown", "x"], TODAY), /ARGUMENT_INVALID/u);
  assert.throws(
    () => parseDriftReportOptions(["--recent-to", "2026-08-22", "--recent-to", "2026-08-23"], TODAY),
    /ARGUMENT_DUPLICATE/u,
  );
  assert.throws(() => parseDriftReportOptions(["--json", "--json"], TODAY), /ARGUMENT_DUPLICATE/u);
});

test("drift report keeps condition parser fail-closed", () => {
  assert.throws(() => parseDriftReportOptions(["--condition", "venue"], TODAY), /expected key=value/u);
});
