import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficialProgramCanaryManifest } from "./n2OfficialProgramCanary";

const build = (dateFrom: string, dateTo: string) => buildOfficialProgramCanaryManifest({
  rows: [],
  cohort: { dateFrom, dateTo },
  codeGitSha: "1234567890abcdef1234567890abcdef12345678",
  generatedAt: "2028-03-01T00:00:00.000Z",
});

test("official program canary rejects impossible cohort dates", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31"]) {
    assert.throws(() => build(date, date), /INVALID_CANARY_COHORT/);
  }
  assert.doesNotThrow(() => build("2028-02-29", "2028-02-29"));
});
