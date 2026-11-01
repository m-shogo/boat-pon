import assert from "node:assert/strict";
import test from "node:test";
import {
  compareForwardV02ClaimedInstants,
  validForwardV02ClaimedInstant,
} from "./forwardV02ClaimedInstant";

/**
 * Direct, synthetic contract tests for the shared v0.2 claimed-clock helper.
 * Caller timestamps are untrusted metadata, never authenticated clock,
 * independent authority, scoring permission, or production inputs.
 */
test("claimed instant accepts real Gregorian dates and explicit known offsets", () => {
  for (const value of [
    "2024-02-29T23:59:59.000000001Z",
    "2000-02-29T00:00:00Z",
    "0001-01-01T00:00:00Z",
    "2026-10-24T09:30:00+09:00",
    "2026-10-24T09:30:00-09:30",
  ]) {
    assert.equal(validForwardV02ClaimedInstant(value), true, value);
  }
});

test("claimed instant rejects calendar rollover and year zero", () => {
  for (const value of [
    "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "0000-01-01T00:00:00Z",
  ]) {
    assert.equal(validForwardV02ClaimedInstant(value), false, value);
  }
});

test("claimed instant rejects hour-24, invalid clock fields and unknown UTC offset", () => {
  for (const value of [
    "2026-10-24T24:00:00Z",
    "2026-10-24T23:60:00Z",
    "2026-10-24T23:59:60Z",
    "2026-10-24T09:00:00+24:00",
    "2026-10-24T09:00:00+09:60",
    "2026-10-24T09:00:00-00:00",
    "2026-10-24T09:00:00",
  ]) {
    assert.equal(validForwardV02ClaimedInstant(value), false, value);
  }
  assert.equal(validForwardV02ClaimedInstant(null), false);
  assert.equal(validForwardV02ClaimedInstant(0), false);
});

test("claimed chronology preserves nanosecond-order differences below Date.parse precision", () => {
  const first = "2026-10-24T09:00:00.000000001Z";
  const second = "2026-10-24T09:00:00.000000002Z";
  assert.equal(compareForwardV02ClaimedInstants(first, second), -1);
  assert.equal(compareForwardV02ClaimedInstants(second, first), 1);
  assert.equal(compareForwardV02ClaimedInstants(first, first), 0);
  assert.equal(compareForwardV02ClaimedInstants(
    "2026-10-24T09:00:00.1Z",
    "2026-10-24T09:00:00.100000000Z",
  ), 0);
});

test("claimed chronology normalizes known offsets before comparing fractions", () => {
  const utc = "2026-10-24T09:00:00.000000001Z";
  const jst = "2026-10-24T18:00:00.000000001+09:00";
  assert.equal(compareForwardV02ClaimedInstants(utc, jst), 0);
  assert.equal(compareForwardV02ClaimedInstants(
    "2026-10-24T09:00:00.000000001Z",
    "2026-10-24T18:00:00.000000002+09:00",
  ), -1);
  assert.equal(compareForwardV02ClaimedInstants(
    "2026-10-24T00:00:00+09:00",
    "2026-10-23T15:00:00Z",
  ), 0);
});

test("claimed chronology orders distinct UTC seconds before fractional digits", () => {
  assert.equal(compareForwardV02ClaimedInstants(
    "2026-10-24T09:00:00.999999999Z",
    "2026-10-24T09:00:01.000000001Z",
  ), -1);
  assert.equal(compareForwardV02ClaimedInstants(
    "2026-10-24T09:00:01.000000001Z",
    "2026-10-24T09:00:00.999999999Z",
  ), 1);
});
