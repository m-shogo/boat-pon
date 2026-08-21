import assert from "node:assert/strict";
import test from "node:test";
import { backfillVenueCode, canonicalBackfillRaceKey, fileDate } from "./n1Backfill";

test("backfill archive filename dates must be real Gregorian dates", () => {
  assert.equal(fileDate("/archive/k280229.lzh"), "2028-02-29");
  assert.throws(() => fileDate("/archive/k260230.lzh"), /invalid JST race date/);
});

test("backfill race identity is canonical before append-only ingest", () => {
  assert.equal(backfillVenueCode("蒲郡"), "07");
  assert.throws(() => backfillVenueCode("UNKNOWN"), /N1_BACKFILL_VENUE_INVALID/);
  assert.equal(canonicalBackfillRaceKey("2028-02-29", "24", 12), "2028-02-29:24:R12");
  assert.throws(() => canonicalBackfillRaceKey("2026-02-30", "01", 1), /invalid JST race date/);
  assert.throws(() => canonicalBackfillRaceKey("2026-08-21", "25", 1), /invalid official venue code/);
  assert.throws(() => canonicalBackfillRaceKey("2026-08-21", "01", 13), /invalid race number/);
});
