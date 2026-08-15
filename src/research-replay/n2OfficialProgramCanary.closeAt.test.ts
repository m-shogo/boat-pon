import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfficialProgramCanaryManifest,
  type OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";

const CODE_SHA = "1234567890abcdef1234567890abcdef12345678";

function raw(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: 6 + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function row(closeAt: string): OfficialProgramCanarySourceRow {
  return {
    raceId: "20040101-01-01",
    date: "2004-01-01",
    venue: "桐生",
    raceNo: 1,
    closeAt,
    sourceFile: "/private/cache/20040101-01-01.json",
    rawJson: raw(),
    importedAt: "2004-01-01 01:00:00",
  };
}

function manifest(closeAt: string) {
  return buildOfficialProgramCanaryManifest({
    rows: [row(closeAt)],
    cohort: { dateFrom: "2004-01-01", dateTo: "2004-01-01" },
    codeGitSha: CODE_SHA,
    generatedAt: "2004-01-02T00:00:00.000Z",
  });
}

test("official program canary rejects normalized or out-of-range close times", () => {
  for (const closeAt of ["24:00", "24:00:00", "23:60", "23:59:60", "99:00", "12:34:567"]) {
    const value = manifest(closeAt);
    assert.equal(value.binding.eligibleRowCount, 0, closeAt);
    assert.equal(value.binding.excludedCount, 1, closeAt);
    assert.equal(value.excluded[0]?.reason, "INVALID_CLOSE_AT", closeAt);
  }
});

test("official program canary preserves valid close-time boundaries", () => {
  for (const closeAt of ["00:00", "23:59", "00:00:00", "23:59:59"]) {
    const value = manifest(closeAt);
    const expectedEligible = closeAt.startsWith("00:00") ? 0 : 1;
    assert.equal(value.binding.eligibleRowCount, expectedEligible, closeAt);
    if (expectedEligible === 0) {
      assert.equal(value.excluded[0]?.reason, "POST_CUTOFF_PRIMARY_IMPORT", closeAt);
    } else {
      assert.equal(value.binding.excludedCount, 0, closeAt);
    }
  }
});
