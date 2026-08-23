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
  assert.throws(() => parseExactaTimeseriesDryRunOptions(["--date"], venues), /DATE_REQUIRED/u);
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue"], venues),
    /VENUE_REQUIRED/u,
  );
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "住之江", "--race"], venues),
    /RACE_REQUIRED/u,
  );
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--checkpoint"], venues),
    /CHECKPOINT_MISSING/u,
  );
  assert.throws(
    () => parseExactaTimeseriesDryRunOptions(["--date", "2026-07-01", "--venue", "住之江", "--race", "6", "--minutes-before-close"], venues),
    /MINUTES_MISSING/u,
  );
});
