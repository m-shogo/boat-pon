import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBeforeInfoBackfillOptions,
  requireBeforeInfoBackfillTarget,
  requireBeforeInfoBackfillTargets,
} from "./beforeInfoBackfillSafety";

test("beforeinfo backfill accepts canonical bounded options", () => {
  assert.deepEqual(
    parseBeforeInfoBackfillOptions({
      fromDate: "2026-08-01",
      toDate: "2026-08-23",
      intervalMsRaw: "15000",
      limitRaw: "0",
      venueFilterRaw: "宮島",
      raceNoFilterRaw: "6",
    }),
    {
      fromDate: "2026-08-01",
      toDate: "2026-08-23",
      intervalMs: 15000,
      limit: 0,
      venueFilter: "宮島",
      raceNoFilter: 6,
    },
  );
  assert.doesNotThrow(() => parseBeforeInfoBackfillOptions({
    fromDate: "2028-02-29",
    toDate: "2028-02-29",
  }));
});

test("beforeinfo backfill rejects unsafe bounded options before access", () => {
  for (const raw of ["-1", "1.5", "fast", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-01", toDate: "2026-08-23", limitRaw: raw }),
      /BEFOREINFO_BACKFILL_LIMIT_INVALID/u,
    );
  }
  for (const raw of ["0", "-1", "1.5", "fast", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-01", toDate: "2026-08-23", intervalMsRaw: raw }),
      /BEFOREINFO_BACKFILL_INTERVAL_MS_INVALID/u,
    );
  }
});

test("beforeinfo backfill rejects invalid filters and date ranges", () => {
  for (const fromDate of ["2026-02-30", "2026-8-01"]) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate, toDate: "2026-08-23" }),
      /BEFOREINFO_BACKFILL_FROM_DATE_INVALID/u,
    );
  }
  assert.throws(
    () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-23", toDate: "2026-08-01" }),
    /BEFOREINFO_BACKFILL_DATE_RANGE_INVALID/u,
  );
  for (const venueFilterRaw of ["unknown", " 宮島 ", "17"]) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-01", toDate: "2026-08-23", venueFilterRaw }),
      /BEFOREINFO_BACKFILL_VENUE_INVALID/u,
    );
  }
  for (const raceNoFilterRaw of ["0", "13", "1.5", "race"] ) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-01", toDate: "2026-08-23", raceNoFilterRaw }),
      /BEFOREINFO_BACKFILL_RACE_NO_INVALID/u,
    );
  }
});

test("beforeinfo backfill preflights every target before top-N selection", () => {
  assert.doesNotThrow(() => requireBeforeInfoBackfillTarget({ date: "2028-02-29", venue: "大村", raceNo: 12 }));
  const targets = [
    { date: "2026-08-01", venue: "宮島", raceNo: 1 },
    { date: "2026-02-30", venue: "宮島", raceNo: 2 },
    { date: "2026-08-02", venue: "宮島", raceNo: 3 },
  ];
  assert.throws(
    () => requireBeforeInfoBackfillTargets(targets),
    /BEFOREINFO_BACKFILL_TARGET_RACE_INVALID/u,
  );
});
