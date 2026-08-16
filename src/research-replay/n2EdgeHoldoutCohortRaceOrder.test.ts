import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildN2EdgeHoldoutCohort } from "./n2EdgeHoldoutCohort";

test("holdout cohort emits same-day race numbers in numeric order", () => {
  const raceKeys = [10, 2, 12, 1, 11, 3, 9, 4, 8, 5, 7, 6]
    .map((raceNo) => `2022-01-01:05:R${raceNo}`);

  const report = buildN2EdgeHoldoutCohort(
    raceKeys.map((canonicalRaceKey) => ({ canonicalRaceKey })),
  );

  assert.equal(report.status, "PASS");
  const expected = Array.from({ length: 12 }, (_, index) => `2022-01-01:05:R${index + 1}`);
  assert.deepEqual(report.races.map((race) => race.canonicalRaceKey), expected);
  assert.equal(report.validationCohortDigest, canonicalHash(expected));
  assert.equal(report.selectedValidationRaceCount, 12);
  assert.equal(report.selectedTestRaceCount, 0);
});
