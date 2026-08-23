import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOddsBackfillDate,
  parseOddsBackfillPositiveSafeInteger,
  requireOddsBackfillDateRange,
  requireOddsBackfillTarget,
  requireOddsBackfillTargets,
} from "./oddsBackfillSafety";

const valid = () => ({
  raceId: "20260823-宮島-06",
  date: "2026-08-23",
  venue: "宮島",
  raceNo: 6,
  selection: "1-2-3",
});

test("odds backfill accepts canonical bounded inputs", () => {
  assert.equal(parseOddsBackfillPositiveSafeInteger("10", "LIMIT"), 10);
  assert.equal(parseOddsBackfillPositiveSafeInteger("1000", "SLEEP_MS", 1000), 1000);
  assert.equal(parseOddsBackfillDate("2028-02-29", "FROM_DATE"), "2028-02-29");
  assert.doesNotThrow(() => requireOddsBackfillDateRange("2026-08-01", "2026-08-23"));
  assert.doesNotThrow(() => requireOddsBackfillTarget(valid()));
});

test("odds backfill rejects coerced or disabled bounds", () => {
  for (const raw of [undefined, "0", "-1", "1.5", "many", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseOddsBackfillPositiveSafeInteger(raw, "LIMIT"),
      /ODDS_BACKFILL_LIMIT_INVALID/u,
    );
  }
  for (const raw of [undefined, "0", "999", "-1", "1.5", "fast", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseOddsBackfillPositiveSafeInteger(raw, "SLEEP_MS", 1000),
      /ODDS_BACKFILL_SLEEP_MS_INVALID/u,
    );
  }
});

test("odds backfill rejects impossible dates and reversed ranges", () => {
  for (const raw of ["2026-02-30", "2026-8-01", "not-a-date"]) {
    assert.throws(() => parseOddsBackfillDate(raw, "FROM_DATE"), /ODDS_BACKFILL_FROM_DATE_INVALID/u);
  }
  assert.throws(
    () => requireOddsBackfillDateRange("2026-08-23", "2026-08-01"),
    /ODDS_BACKFILL_DATE_RANGE_INVALID/u,
  );
});

test("odds backfill preflights every candidate before network top-N", () => {
  const invalid = [
    { ...valid(), date: "2026-02-30", raceId: "20260230-宮島-06" },
    { ...valid(), venue: "unknown", raceId: "20260823-unknown-06" },
    { ...valid(), venue: "17", raceId: "20260823-17-06" },
    { ...valid(), raceNo: 13, raceId: "20260823-宮島-13" },
    { ...valid(), selection: "1-1-2" },
    { ...valid(), raceId: "20260823-大村-06" },
  ];
  for (const target of invalid) {
    assert.throws(
      () => requireOddsBackfillTargets([valid(), target, { ...valid(), raceId: "20260824-宮島-06", date: "2026-08-24" }]),
      /ODDS_BACKFILL_TARGET_(RACE|VENUE|SELECTION|IDENTITY)_INVALID/u,
    );
  }
});
