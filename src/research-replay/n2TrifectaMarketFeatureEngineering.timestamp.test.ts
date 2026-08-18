import assert from "node:assert/strict";
import test from "node:test";

import { buildN2TrifectaMarketSnapshotFeatures } from "./n2TrifectaMarketFeatureEngineering";

function odds(): Map<string, number> {
  const out = new Map<string, number>();
  let value = 2;
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        out.set(`${first}-${second}-${third}`, value);
        value += 0.1;
      }
    }
  }
  return out;
}

function build(capturedAt: string, availableAt: string) {
  return buildN2TrifectaMarketSnapshotFeatures({
    raceIdentity: "20260807-05-01",
    checkpointLabel: "T-5",
    capturedAt,
    availableAt,
    odds: odds(),
  });
}

test("market feature core rejects JavaScript-normalized timestamps", () => {
  const impossibleDate = build(
    "2026-02-30T01:25:30.000Z",
    "2026-02-28T01:25:00.000Z",
  );
  assert.equal(impossibleDate.status, "BLOCKED");
  assert.ok(impossibleDate.blockers.includes("CAPTURED_AT_INVALID"));

  const normalizedClock = build(
    "2026-08-07T24:00:00.000Z",
    "2026-08-07T23:59:00.000Z",
  );
  assert.equal(normalizedClock.status, "BLOCKED");
  assert.ok(normalizedClock.blockers.includes("CAPTURED_AT_INVALID"));

  const timezoneMissing = build(
    "2026-08-07T01:25:30.000",
    "2026-08-07T01:25:00.000Z",
  );
  assert.equal(timezoneMissing.status, "BLOCKED");
  assert.ok(timezoneMissing.blockers.includes("CAPTURED_AT_INVALID"));
});

test("market feature core preserves valid leap-day and explicit-offset timestamps", () => {
  const result = build(
    "2028-02-29T10:25:30+09:00",
    "2028-02-29T10:25:00+09:00",
  );
  assert.equal(result.status, "PASS");
  assert.ok(result.snapshot);
  assert.equal(result.snapshot.capturedAt, "2028-02-29T10:25:30+09:00");
  assert.equal(result.snapshot.availableAt, "2028-02-29T10:25:00+09:00");
});
