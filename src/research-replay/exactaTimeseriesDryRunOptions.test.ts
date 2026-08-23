import assert from "node:assert/strict";
import test from "node:test";

import { parseExactaTimeseriesDryRunOptions } from "./exactaTimeseriesDryRunOptions";

const venues = new Set(["住之江", "戸田"]);

test("exacta dry-run accepts canonical request metadata", () => {
  assert.deepEqual(
    parseExactaTimeseriesDryRunOptions(
      ["--date", "2028-02-29", "--venue", "住之江", "--race", "6", "--checkpoint", "T-5", "--minutes-before-close", "5"],
      venues,
    ),
    { date: "2028-02-29", venue: "住之江", raceNo: 6, checkpoint: "T-5", minutesBeforeClose: 5 },
  );
  assert.deepEqual(
    parseExactaTimeseriesDryRunOptions(["--", "--date", "2028-02-29", "--venue", "戸田", "--race", "1"], venues),
    { date: "2028-02-29", venue: "戸田", raceNo: 1, checkpoint: "ad-hoc", minutesBeforeClose: null },
  );
});

test("exacta dry-run rejects invalid dates before fetch", () => {
  for (const date of ["2026-02-30", "2026-7-01", "not-a-date", "2026-07-01T00:00:00Z"]) {
    assert.throws(
      () => parseExactaTimeseriesDryRunOptions(["--date", date, "--venue", "住之江", "--race", "6"], venues),
      /EXACTA_TIMESERIES_DRY_RUN_DATE_INVALID/u,
    );
  }
});

test("exacta dry-run rejects invalid venue, race, and checkpoint metadata", () => {
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "unknown", "--race", "6"], venues),
    /EXACTA_TIMESERIES_DRY_RUN_VENUE_INVALID/u,
  );
  for (const race of ["0", "13", "1.5", "06", "many"]) {
    assert.throws(
      () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "住之江", "--race", race], venues),
      /EXACTA_TIMESERIES_DRY_RUN_RACE_INVALID/u,
    );
  }
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--checkpoint", "T-1"], venues),
    /EXACTA_TIMESERIES_DRY_RUN_CHECKPOINT_INVALID/u,
  );
});

test("exacta dry-run rejects non-finite or negative minutes metadata", () => {
  for (const minutes of ["-1", "NaN", "Infinity", " 5", ""]) {
    assert.throws(
      () => parseExactaTimeseriesDryRunOptions([
        "--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--minutes-before-close", minutes,
      ], venues),
      /EXACTA_TIMESERIES_DRY_RUN_MINUTES_INVALID/u,
    );
  }
  assert.equal(
    parseExactaTimeseriesDryRunOptions([
      "--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--minutes-before-close", "1.5",
    ], venues).minutesBeforeClose,
    1.5,
  );
});

test("exacta dry-run rejects missing option values", () => {
  for (const argv of [
    ["--date"],
    ["--date", "2026-07-01", "--venue"],
    ["--date", "2026-07-01", "--venue", "住之江", "--race"],
    ["--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--checkpoint"],
    ["--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--minutes-before-close"],
  ]) {
    assert.throws(
      () => parseExactaTimeseriesDryRunOptions(argv, venues),
      /EXACTA_TIMESERIES_DRY_RUN_ARGUMENT_MISSING/u,
    );
  }
});

test("exacta dry-run rejects unknown or duplicate arguments", () => {
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--typo", "x"], venues),
    /EXACTA_TIMESERIES_DRY_RUN_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions([
      "--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--race", "7",
    ], venues),
    /EXACTA_TIMESERIES_DRY_RUN_ARGUMENT_DUPLICATE/u,
  );
});
