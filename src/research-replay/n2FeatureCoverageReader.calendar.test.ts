import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalN2CoverageRaceKey,
  readOfficialProgramCoverageEvents,
} from "./n2FeatureCoverageReader";

test("coverage race identity rejects impossible calendar dates", () => {
  assert.throws(() => canonicalN2CoverageRaceKey({
    raceId: "20040230-01-01",
    date: "2004-02-30",
    venue: "01",
    raceNo: 1,
  }), /N2_COVERAGE_INVALID_PROGRAM_DATE/);

  assert.equal(canonicalN2CoverageRaceKey({
    raceId: "20040229-01-01",
    date: "2004-02-29",
    venue: "01",
    raceNo: 1,
  }), "2004-02-29:01:R1");
});

test("coverage reader rejects impossible query-range dates before opening databases", () => {
  assert.throws(() => readOfficialProgramCoverageEvents({
    primaryDbPath: "/definitely/not/opened-primary.sqlite",
    sidecarDbPath: "/definitely/not/opened-sidecar.sqlite",
    dateFrom: "2004-02-30",
    dateTo: "2004-12-31",
  }), /N2_COVERAGE_INVALID_DATE_RANGE/);

  assert.throws(() => readOfficialProgramCoverageEvents({
    primaryDbPath: "/definitely/not/opened-primary.sqlite",
    sidecarDbPath: "/definitely/not/opened-sidecar.sqlite",
    dateFrom: "2004-01-01",
    dateTo: "2004-04-31",
  }), /N2_COVERAGE_INVALID_DATE_RANGE/);
});
