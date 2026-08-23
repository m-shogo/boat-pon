import assert from "node:assert/strict";
import test from "node:test";

import {
  parseExactaClosingOddsAuditSleepMs,
  requireExactaClosingOddsAuditCandidate,
  requireExactaClosingOddsAuditCandidates,
} from "./exactaClosingOddsAuditSafety";

const valid = () => ({
  date: "2026-08-23",
  venue: "宮島",
  raceNo: 6,
  quarter: "2026-Q3",
});

test("exacta closing odds audit accepts canonical low-frequency inputs", () => {
  assert.equal(parseExactaClosingOddsAuditSleepMs("1500"), 1500);
  assert.doesNotThrow(() => requireExactaClosingOddsAuditCandidate(valid()));
  assert.doesNotThrow(() => requireExactaClosingOddsAuditCandidate({
    date: "2028-02-29",
    venue: "24",
    raceNo: 12,
    quarter: "2028-Q1",
  }));
});

test("exacta closing odds audit rejects disabled or coerced sleep intervals", () => {
  for (const raw of ["0", "-1", "1.5", "fast", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(() => parseExactaClosingOddsAuditSleepMs(raw), /EXACTA_CLOSING_ODDS_AUDIT_SLEEP_MS_INVALID/u);
  }
});

test("exacta closing odds audit rejects invalid candidate identity before sampling", () => {
  const invalid = [
    { ...valid(), date: "2026-02-30", quarter: "2026-Q1" },
    { ...valid(), venue: "unknown" },
    { ...valid(), raceNo: 13 },
    { ...valid(), quarter: "2026-Q2" },
  ];
  for (const candidate of invalid) {
    assert.throws(
      () => requireExactaClosingOddsAuditCandidate(candidate),
      /EXACTA_CLOSING_ODDS_AUDIT_(RACE_IDENTITY|VENUE|QUARTER)_INVALID/u,
    );
  }
});

test("exacta closing odds audit fails closed on any invalid pre-sampling candidate", () => {
  assert.throws(
    () => requireExactaClosingOddsAuditCandidates([
      valid(),
      { ...valid(), date: "2026-02-30", quarter: "2026-Q1" },
      { ...valid(), date: "2026-08-24" },
    ]),
    /EXACTA_CLOSING_ODDS_AUDIT_RACE_IDENTITY_INVALID/u,
  );
});
