import assert from "node:assert/strict";
import test from "node:test";

import { canonicalN2CoverageRaceKey } from "./n2FeatureCoverageReader";

function row(venue: string) {
  return {
    raceId: `20260816-${venue}-01`,
    date: "2026-08-16",
    venue,
    raceNo: 1,
  };
}

test("feature coverage accepts official venue-code boundaries", () => {
  assert.equal(
    canonicalN2CoverageRaceKey(row("01")),
    "2026-08-16:01:R1",
  );
  assert.equal(
    canonicalN2CoverageRaceKey(row("24")),
    "2026-08-16:24:R1",
  );
});

test("feature coverage rejects two-digit venue codes outside 01 through 24", () => {
  for (const venue of ["00", "25", "99"]) {
    assert.throws(
      () => canonicalN2CoverageRaceKey(row(venue)),
      /N2_COVERAGE_INVALID_PROGRAM_VENUE/,
    );
  }
});
