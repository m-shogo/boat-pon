import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHistoricalAltOddsOptionalDate,
  parseHistoricalAltOddsPositiveSafeInteger,
  parseHistoricalAltOddsPriority,
  parseHistoricalAltOddsRaceNo,
  parseHistoricalAltOddsVenue,
  requireHistoricalAltOddsDateRange,
  requireHistoricalAltOddsTarget,
  requireHistoricalAltOddsTargets,
} from "./historicalAlternativeOddsBackfillSafety";

const valid = () => ({
  raceId: "20260823-宮島-06",
  date: "2026-08-23",
  venue: "宮島",
  raceNo: 6,
});

test("historical alternative odds accepts canonical safety inputs", () => {
  assert.equal(parseHistoricalAltOddsPositiveSafeInteger("30", "LIMIT"), 30);
  assert.equal(parseHistoricalAltOddsPositiveSafeInteger("1000", "SLEEP_MS", 1000), 1000);
  assert.equal(parseHistoricalAltOddsOptionalDate("2028-02-29", "FROM_DATE"), "2028-02-29");
  assert.equal(parseHistoricalAltOddsVenue("宮島"), "宮島");
  assert.equal(parseHistoricalAltOddsRaceNo("6"), 6);
  assert.equal(parseHistoricalAltOddsPriority("condB"), "condB");
  assert.doesNotThrow(() => requireHistoricalAltOddsTarget(valid()));
});

test("historical alternative odds rejects unsafe bounds and cadence", () => {
  for (const raw of ["0", "-1", "1.5", "many", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(() => parseHistoricalAltOddsPositiveSafeInteger(raw, "LIMIT"), /HISTORICAL_ALT_ODDS_LIMIT_INVALID/u);
  }
  for (const raw of ["0", "999", "-1", "1.5", "fast", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseHistoricalAltOddsPositiveSafeInteger(raw, "SLEEP_MS", 1000),
      /HISTORICAL_ALT_ODDS_SLEEP_MS_INVALID/u,
    );
  }
});

test("historical alternative odds rejects unsafe query filters", () => {
  for (const raw of ["2026-02-30", "2026-8-01", "not-a-date"]) {
    assert.throws(() => parseHistoricalAltOddsOptionalDate(raw, "FROM_DATE"), /HISTORICAL_ALT_ODDS_FROM_DATE_INVALID/u);
  }
  assert.throws(
    () => requireHistoricalAltOddsDateRange("2026-08-23", "2026-08-01"),
    /HISTORICAL_ALT_ODDS_DATE_RANGE_INVALID/u,
  );
  for (const venue of ["unknown", "17", " 宮島 ", "宮島' OR 1=1 --"]) {
    assert.throws(() => parseHistoricalAltOddsVenue(venue), /HISTORICAL_ALT_ODDS_VENUE_INVALID/u);
  }
  for (const raceNo of ["0", "13", "1.5", "race"]) {
    assert.throws(() => parseHistoricalAltOddsRaceNo(raceNo), /HISTORICAL_ALT_ODDS_RACE_NO_INVALID/u);
  }
  assert.throws(() => parseHistoricalAltOddsPriority("anything"), /HISTORICAL_ALT_ODDS_PRIORITY_INVALID/u);
});

test("historical alternative odds preflights every candidate before top-N", () => {
  const invalid = [
    { ...valid(), date: "2026-02-30", raceId: "20260230-宮島-06" },
    { ...valid(), venue: "unknown", raceId: "20260823-unknown-06" },
    { ...valid(), raceNo: 13, raceId: "20260823-宮島-13" },
    { ...valid(), raceId: "20260823-大村-06" },
  ];
  for (const target of invalid) {
    assert.throws(
      () => requireHistoricalAltOddsTargets([valid(), target, { ...valid(), date: "2026-08-24", raceId: "20260824-宮島-06" }]),
      /HISTORICAL_ALT_ODDS_TARGET_(RACE|VENUE|IDENTITY)_INVALID/u,
    );
  }
});
