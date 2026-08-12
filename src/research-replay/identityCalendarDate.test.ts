import assert from "node:assert/strict";
import test from "node:test";

import { canonicalRaceKey, parseCanonicalRaceKey } from "./identity";

test("canonical race identity accepts real leap-day dates", () => {
  const key = canonicalRaceKey("2028-02-29", "01", 12);
  assert.equal(key, "2028-02-29:01:R12");
  assert.deepEqual(parseCanonicalRaceKey(key), {
    raceDateJst: "2028-02-29",
    venueCode: "01",
    raceNo: 12,
    canonicalRaceKey: key,
  });
});

test("canonical race identity rejects normalized impossible calendar dates", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10"]) {
    assert.throws(() => canonicalRaceKey(date, "01", 1), /invalid JST race date/);
    assert.throws(() => parseCanonicalRaceKey(`${date}:01:R1`), /invalid canonical race key/);
  }
});
