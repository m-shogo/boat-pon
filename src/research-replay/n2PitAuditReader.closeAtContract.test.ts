import assert from "node:assert/strict";
import test from "node:test";

import { decisionCutoffFromProgram } from "./n2PitAuditReader";

const base = {
  raceId: "20240601-桐生-01",
  date: "2024-06-01",
  venue: "桐生",
  raceNo: 1,
  closeAt: "10:00",
};
const key = "2024-06-01:01:R1";

test("PIT program cutoff accepts canonical clock boundaries", () => {
  assert.equal(
    decisionCutoffFromProgram({ ...base, closeAt: "00:00" }, key),
    "2024-05-31T15:00:00.000Z",
  );
  assert.equal(
    decisionCutoffFromProgram({ ...base, closeAt: "23:59:59" }, key),
    "2024-06-01T14:59:59.000Z",
  );
});

test("PIT program cutoff rejects clock values that Date.parse can normalize across the race date", () => {
  for (const closeAt of ["24:00", "24:00:00", "23:60", "23:59:60", "-1:00", "7:00"]) {
    assert.equal(decisionCutoffFromProgram({ ...base, closeAt }, key), null, closeAt);
  }
});
