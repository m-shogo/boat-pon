import assert from "node:assert/strict";
import test from "node:test";

import {
  EXACTA_BACKFILL_MAX_SLEEP_MS,
  parseExactaBackfillOptionalDate,
  parseExactaBackfillPositiveSafeInteger,
  requireExactaBackfillDateRange,
  requireExactaBackfillTarget,
  requireExactaBackfillTargets,
} from "./exactaClosingOddsBackfillSafety";

const valid = () => ({
  raceId: "20260823-宮島-06",
  date: "2026-08-23",
  venue: "宮島",
  venueCode: "17",
  raceNo: 6,
});

test("exacta backfill accepts canonical bounded inputs", () => {
  assert.equal(parseExactaBackfillPositiveSafeInteger("30", "LIMIT"), 30);
  assert.equal(parseExactaBackfillPositiveSafeInteger("1000", "SLEEP_MS", 1000), 1000);
  assert.equal(
    parseExactaBackfillPositiveSafeInteger(String(EXACTA_BACKFILL_MAX_SLEEP_MS), "SLEEP_MS", 1000),
    EXACTA_BACKFILL_MAX_SLEEP_MS,
  );
  assert.equal(parseExactaBackfillPositiveSafeInteger("30", "BATCH_SIZE"), 30);
  assert.equal(parseExactaBackfillOptionalDate("2028-02-29", "FROM_DATE"), "2028-02-29");
  assert.equal(parseExactaBackfillOptionalDate("", "TO_DATE"), "");
  assert.doesNotThrow(() => requireExactaBackfillTarget(valid()));
});

test("exacta backfill rejects coerced or disabled bounds", () => {
  for (const label of ["LIMIT", "BATCH_SIZE"] as const) {
    for (const raw of ["0", "-1", "1.5", "many", String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(() => parseExactaBackfillPositiveSafeInteger(raw, label), new RegExp(`EXACTA_BACKFILL_${label}_INVALID`, "u"));
    }
  }
  for (const raw of [
    "0",
    "999",
    "-1",
    "1.5",
    "fast",
    String(EXACTA_BACKFILL_MAX_SLEEP_MS + 1),
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.throws(
      () => parseExactaBackfillPositiveSafeInteger(raw, "SLEEP_MS", 1000),
      /EXACTA_BACKFILL_SLEEP_MS_INVALID/u,
    );
  }
});

test("exacta backfill rejects impossible or reversed date ranges", () => {
  for (const raw of ["2026-02-30", "2026-8-01", "not-a-date"]) {
    assert.throws(() => parseExactaBackfillOptionalDate(raw, "FROM_DATE"), /EXACTA_BACKFILL_FROM_DATE_INVALID/u);
  }
  assert.throws(
    () => requireExactaBackfillDateRange("2026-08-23", "2026-08-01"),
    /EXACTA_BACKFILL_DATE_RANGE_INVALID/u,
  );
});

test("exacta backfill preflights every candidate before top-N", () => {
  const invalid = [
    { ...valid(), date: "2026-02-30", raceId: "20260230-宮島-06" },
    { ...valid(), venue: "unknown", raceId: "20260823-unknown-06" },
    { ...valid(), venueCode: "18" },
    { ...valid(), raceNo: 13, raceId: "20260823-宮島-13" },
    { ...valid(), raceId: "20260823-大村-06" },
  ];
  for (const target of invalid) {
    assert.throws(
      () => requireExactaBackfillTargets([valid(), target, { ...valid(), date: "2026-08-24", raceId: "20260824-宮島-06" }]),
      /EXACTA_BACKFILL_TARGET_(RACE|VENUE|VENUE_CODE|IDENTITY)_INVALID/u,
    );
  }
});
