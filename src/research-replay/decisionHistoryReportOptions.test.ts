import assert from "node:assert/strict";
import test from "node:test";

import { parseDecisionHistoryReportOptions } from "./decisionHistoryReportOptions";

test("decision-history report accepts canonical filters", () => {
  assert.deepEqual(
    parseDecisionHistoryReportOptions([
      "--", "--from", "2028-02-29", "--to", "2028-03-01", "--decision", "buy",
      "--model-version", "v4", "--run-kind", "paper-live", "--json",
    ]),
    {
      from: "2028-02-29",
      to: "2028-03-01",
      decision: "BUY",
      modelVersion: "v4",
      runKind: "paper-live",
      json: true,
    },
  );
});

test("decision-history report rejects impossible or non-canonical dates", () => {
  for (const [flag, value] of [
    ["--from", "2026-02-30"],
    ["--from", "2026-6-01"],
    ["--to", "2026-08-32"],
    ["--to", "2026-08-23T00:00:00Z"],
  ] as const) {
    assert.throws(
      () => parseDecisionHistoryReportOptions([flag, value]),
      /DECISION_HISTORY_REPORT_(FROM|TO)_INVALID/u,
    );
  }
});

test("decision-history report rejects reversed date ranges", () => {
  assert.throws(
    () => parseDecisionHistoryReportOptions(["--from", "2026-08-24", "--to", "2026-08-23"]),
    /DECISION_HISTORY_REPORT_DATE_RANGE_INVALID/u,
  );
});

test("decision-history report rejects unknown decision values", () => {
  assert.throws(
    () => parseDecisionHistoryReportOptions(["--decision", "HOLD"]),
    /DECISION_HISTORY_REPORT_DECISION_INVALID/u,
  );
});

test("decision-history report rejects missing, padded, unknown, and duplicate options", () => {
  assert.throws(() => parseDecisionHistoryReportOptions(["--from"]), /ARGUMENT_MISSING/u);
  assert.throws(() => parseDecisionHistoryReportOptions(["--model-version", " "]), /MODEL_VERSION_INVALID/u);
  assert.throws(() => parseDecisionHistoryReportOptions(["--run-kind", " paper-live"]), /RUN_KIND_INVALID/u);
  assert.throws(() => parseDecisionHistoryReportOptions(["--unknown", "x"]), /ARGUMENT_INVALID/u);
  assert.throws(
    () => parseDecisionHistoryReportOptions(["--decision", "BUY", "--decision", "WATCH"]),
    /ARGUMENT_DUPLICATE/u,
  );
  assert.throws(() => parseDecisionHistoryReportOptions(["--json", "--json"]), /ARGUMENT_DUPLICATE/u);
});
