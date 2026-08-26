import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORICAL_CLOSING_ODDS_AUDIT_MAX_LIMIT,
  HISTORICAL_CLOSING_ODDS_AUDIT_MAX_SLEEP_MS,
  parseHistoricalClosingOddsAuditOptions,
} from "./historicalClosingOddsAuditOptions";

const VENUES = new Set(["宮島", "大村"]);
const valid = () => ({
  limit: "30",
  sleepMs: "1500",
  fromDate: "2025-01-01",
  toDate: "2026-08-23",
  venueFilter: "宮島",
  raceNoFilter: "6",
  categoryFilter: "condB",
});

test("historical closing odds audit accepts canonical bounded options", () => {
  assert.deepEqual(parseHistoricalClosingOddsAuditOptions(valid(), VENUES), {
    limit: 30,
    sleepMs: 1500,
    fromDate: "2025-01-01",
    toDate: "2026-08-23",
    venueFilter: "宮島",
    raceNoFilter: 6,
    categoryFilter: "condB",
  });
});

test("historical closing odds audit rejects unbounded or coerced limits", () => {
  for (const limit of ["0", "-1", "1.5", "30x", String(Number.MAX_SAFE_INTEGER + 1), String(HISTORICAL_CLOSING_ODDS_AUDIT_MAX_LIMIT + 1)]) {
    assert.throws(
      () => parseHistoricalClosingOddsAuditOptions({ ...valid(), limit }, VENUES),
      /HISTORICAL_CLOSING_ODDS_AUDIT_LIMIT_INVALID/u,
    );
  }
});

test("historical closing odds audit requires a real positive bounded sleep interval", () => {
  for (const sleepMs of [
    "0",
    "-1",
    "1.5",
    "fast",
    String(HISTORICAL_CLOSING_ODDS_AUDIT_MAX_SLEEP_MS + 1),
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.throws(
      () => parseHistoricalClosingOddsAuditOptions({ ...valid(), sleepMs }, VENUES),
      /HISTORICAL_CLOSING_ODDS_AUDIT_SLEEP_MS_INVALID/u,
    );
  }
  assert.equal(
    parseHistoricalClosingOddsAuditOptions({ ...valid(), sleepMs: String(HISTORICAL_CLOSING_ODDS_AUDIT_MAX_SLEEP_MS) }, VENUES).sleepMs,
    HISTORICAL_CLOSING_ODDS_AUDIT_MAX_SLEEP_MS,
  );
});

test("historical closing odds audit rejects impossible dates before source access", () => {
  for (const patch of [
    { fromDate: "2026-02-30" },
    { toDate: "2026-02-30" },
    { fromDate: "2026-08-24", toDate: "2026-08-23" },
  ]) {
    assert.throws(
      () => parseHistoricalClosingOddsAuditOptions({ ...valid(), ...patch }, VENUES),
      /HISTORICAL_CLOSING_ODDS_AUDIT_(FROM_DATE|TO_DATE|DATE_RANGE)_INVALID/u,
    );
  }
  assert.doesNotThrow(() => parseHistoricalClosingOddsAuditOptions({ ...valid(), fromDate: "2028-02-29", toDate: "2028-03-01" }, VENUES));
});

test("historical closing odds audit validates venue, race, and category filters", () => {
  assert.throws(
    () => parseHistoricalClosingOddsAuditOptions({ ...valid(), venueFilter: "unknown" }, VENUES),
    /HISTORICAL_CLOSING_ODDS_AUDIT_VENUE_INVALID/u,
  );
  for (const raceNoFilter of ["0", "13", "1.5", "1x"]) {
    assert.throws(
      () => parseHistoricalClosingOddsAuditOptions({ ...valid(), raceNoFilter }, VENUES),
      /HISTORICAL_CLOSING_ODDS_AUDIT_RACE_NO_INVALID/u,
    );
  }
  assert.throws(
    () => parseHistoricalClosingOddsAuditOptions({ ...valid(), categoryFilter: "other" }, VENUES),
    /HISTORICAL_CLOSING_ODDS_AUDIT_CATEGORY_INVALID/u,
  );
});
