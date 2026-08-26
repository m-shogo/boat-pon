import assert from "node:assert/strict";
import test from "node:test";

import {
  BEFOREINFO_BACKFILL_MAX_INTERVAL_MS,
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
    }),
    {
      fromDate: "2026-08-01",
      toDate: "2026-08-23",
      intervalMs: 15000,
      limit: 0,
    },
  );
  assert.doesNotThrow(() => parseBeforeInfoBackfillOptions({
    fromDate: "2028-02-29",
    toDate: "2028-02-29",
  }));
  assert.equal(
    parseBeforeInfoBackfillOptions({
      fromDate: "2026-08-01",
      toDate: "2026-08-23",
      intervalMsRaw: String(BEFOREINFO_BACKFILL_MAX_INTERVAL_MS),
    }).intervalMs,
    BEFOREINFO_BACKFILL_MAX_INTERVAL_MS,
  );
});

test("beforeinfo backfill rejects unsafe bounded options before access", () => {
  for (const raw of ["-1", "1.5", "fast", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-01", toDate: "2026-08-23", limitRaw: raw }),
      /BEFOREINFO_BACKFILL_LIMIT_INVALID/u,
    );
  }
  for (const raw of [
    "0",
    "-1",
    "1.5",
    "fast",
    String(BEFOREINFO_BACKFILL_MAX_INTERVAL_MS + 1),
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.throws(
      () => parseBeforeInfoBackfillOptions({ fromDate: "2026-08-01", toDate: "2026-08-23", intervalMsRaw: raw }),
      /BEFOREINFO_BACKFILL_INTERVAL_MS_INVALID/u,
    );
  }
});

test("beforeinfo backfill rejects impossible or reversed date ranges", () => {
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
});

test("beforeinfo backfill preflights every target before top-N selection", () => {
  assert.doesNotThrow(() => requireBeforeInfoBackfillTarget({
    raceId: "20280229-大村-12",
    date: "2028-02-29",
    venue: "大村",
    raceNo: 12,
  }));
  for (const invalid of [
    { raceId: "20260230-宮島-02", date: "2026-02-30", venue: "宮島", raceNo: 2 },
    { raceId: "20260802-unknown-03", date: "2026-08-02", venue: "unknown", raceNo: 3 },
    { raceId: "20260802-17-03", date: "2026-08-02", venue: "17", raceNo: 3 },
    { raceId: "20260802-宮島-13", date: "2026-08-02", venue: "宮島", raceNo: 13 },
  ]) {
    assert.throws(
      () => requireBeforeInfoBackfillTargets([
        { raceId: "20260801-宮島-01", date: "2026-08-01", venue: "宮島", raceNo: 1 },
        invalid,
        { raceId: "20260803-宮島-04", date: "2026-08-03", venue: "宮島", raceNo: 4 },
      ]),
      /BEFOREINFO_BACKFILL_TARGET_(RACE|VENUE)_INVALID/u,
    );
  }
});

test("beforeinfo backfill rejects race_id that does not match target identity", () => {
  assert.throws(
    () => requireBeforeInfoBackfillTarget({
      raceId: "20260803-宮島-04",
      date: "2026-08-02",
      venue: "宮島",
      raceNo: 3,
    }),
    /BEFOREINFO_BACKFILL_TARGET_IDENTITY_INVALID/u,
  );
});
