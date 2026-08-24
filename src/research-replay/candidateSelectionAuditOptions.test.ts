import assert from "node:assert/strict";
import test from "node:test";

import {
  addCandidateSelectionAuditDays,
  parseCandidateSelectionAuditOptions,
} from "./candidateSelectionAuditOptions";

test("candidate selection audit accepts canonical options", () => {
  assert.deepEqual(
    parseCandidateSelectionAuditOptions(
      ["--date", "2028-02-29", "--limit=5", "--json", "--strict"],
      "2026-08-23",
    ),
    { date: "2028-02-29", limit: 5, json: true, strict: true },
  );
  assert.deepEqual(
    parseCandidateSelectionAuditOptions(["--", "--date=2026-08-23"], "2026-08-22"),
    { date: "2026-08-23", limit: 20, json: false, strict: false },
  );
  assert.equal(addCandidateSelectionAuditDays("2028-02-29", -180), "2027-09-02");
});

test("candidate selection audit rejects impossible or non-canonical dates", () => {
  for (const date of ["2026-02-30", "2026-8-23", "not-a-date", "2026-08-23T00:00:00Z"]) {
    assert.throws(
      () => parseCandidateSelectionAuditOptions([`--date=${date}`], "2026-08-23"),
      /CANDIDATE_SELECTION_AUDIT_DATE_INVALID/u,
    );
  }
  assert.throws(
    () => parseCandidateSelectionAuditOptions(["--date"], "2026-08-23"),
    /CANDIDATE_SELECTION_AUDIT_DATE_MISSING/u,
  );
});

test("candidate selection audit rejects lossy or unsafe limits", () => {
  for (const limit of ["0", "-1", "1.5", "many", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseCandidateSelectionAuditOptions(["--limit", limit], "2026-08-23"),
      /CANDIDATE_SELECTION_AUDIT_LIMIT_INVALID/u,
    );
  }
  assert.throws(
    () => parseCandidateSelectionAuditOptions(["--limit"], "2026-08-23"),
    /CANDIDATE_SELECTION_AUDIT_LIMIT_MISSING/u,
  );
});

test("candidate selection audit rejects unknown arguments instead of silently weakening the audit", () => {
  for (const argv of [
    ["--strcit"],
    ["--limt=5"],
    ["unexpected-positional"],
  ]) {
    assert.throws(
      () => parseCandidateSelectionAuditOptions(argv, "2026-08-23"),
      /CANDIDATE_SELECTION_AUDIT_ARGUMENT_INVALID/u,
    );
  }
});

test("candidate selection audit rejects duplicate logical options", () => {
  for (const argv of [
    ["--strict", "--strict"],
    ["--json", "--json"],
    ["--date", "2026-08-23", "--date=2026-08-24"],
    ["--limit=5", "--limit", "6"],
  ]) {
    assert.throws(
      () => parseCandidateSelectionAuditOptions(argv, "2026-08-23"),
      /CANDIDATE_SELECTION_AUDIT_ARGUMENT_DUPLICATE/u,
    );
  }
});

test("candidate selection audit day arithmetic rejects non-canonical inputs", () => {
  assert.throws(
    () => addCandidateSelectionAuditDays("2026-02-30", -180),
    /CANDIDATE_SELECTION_AUDIT_DATE_INVALID/u,
  );
  assert.throws(
    () => addCandidateSelectionAuditDays("2026-08-23", 1.5),
    /CANDIDATE_SELECTION_AUDIT_DAY_DELTA_INVALID/u,
  );
});
