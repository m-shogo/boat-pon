import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfficialProgramCanaryManifest,
  type OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";

function raw(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: "B1",
      nationalWinRate: 5,
      nationalTop2Rate: 30,
      localWinRate: 5,
      localTop2Rate: 30,
      motorTop2Rate: 30,
      boatTop2Rate: 30,
    })),
  });
}

function manifest(row: OfficialProgramCanarySourceRow) {
  return buildOfficialProgramCanaryManifest({
    rows: [row],
    cohort: { dateFrom: "2004-01-01", dateTo: "2004-01-01" },
    codeGitSha: "1234567890abcdef1234567890abcdef12345678",
    generatedAt: "2004-01-02T00:00:00Z",
  });
}

const base = {
  date: "2004-01-01",
  raceNo: 1,
  closeAt: "12:00",
  sourceFile: "/cache/program.json",
  rawJson: raw(),
  importedAt: "2004-01-01 01:00:00",
};

test("primary venue-label identity maps to the canonical venue-code key", () => {
  const result = manifest({
    ...base,
    raceId: "20040101-びわこ-01",
    venue: "びわこ",
  });
  assert.equal(result.binding.items[0].primaryIdentityEncoding, "venue_label");
  assert.equal(result.binding.items[0].canonicalRaceKey, "2004-01-01:11:R1");
});

test("legacy or fixture venue-code identity remains explicit and canonical", () => {
  const result = manifest({
    ...base,
    raceId: "20040101-11-01",
    venue: "びわこ",
  });
  assert.equal(result.binding.items[0].primaryIdentityEncoding, "venue_code");
  assert.equal(result.binding.items[0].canonicalRaceKey, "2004-01-01:11:R1");
});

test("arbitrary primary identity aliases remain rejected", () => {
  const result = manifest({
    ...base,
    raceId: "20040101-lake-01",
    venue: "びわこ",
  });
  assert.equal(result.binding.items.length, 0);
  assert.equal(result.excluded[0].reason, "RACE_IDENTITY_MISMATCH");
});
