import assert from "node:assert/strict";
import test from "node:test";
import { canonicalUtcTimestamp } from "./canonical";

test("canonical timestamp rejects impossible Gregorian dates instead of normalizing them", () => {
  for (const value of [
    "2026-02-30T12:00:00Z",
    "2026-04-31T09:30:00+09:00",
    "2026-02-29T00:00:00Z",
    "2026-13-01T00:00:00Z",
  ]) {
    assert.throws(() => canonicalUtcTimestamp(value), /invalid timestamp/);
  }
});

test("canonical timestamp rejects implicit timezone and normalized ISO clocks", () => {
  for (const value of [
    "2026-08-05T09:30:00",
    "2026-08-05T24:00:00Z",
    "2026-08-05T23:60:00Z",
    "2026-08-05T23:59:60Z",
  ]) {
    assert.throws(() => canonicalUtcTimestamp(value), /invalid timestamp/);
  }
});

test("canonical timestamp preserves valid leap-day and timezone normalization", () => {
  assert.equal(
    canonicalUtcTimestamp("2028-02-29T09:30:00+09:00"),
    "2028-02-29T00:30:00.000Z",
  );
  assert.equal(
    canonicalUtcTimestamp("2028-02-29T00:30:00Z"),
    "2028-02-29T00:30:00.000Z",
  );
});

test("canonical timestamp keeps legacy parseable non-ISO inputs compatible", () => {
  assert.equal(
    canonicalUtcTimestamp("May 20, 2026 00:00:00 GMT"),
    "2026-05-20T00:00:00.000Z",
  );
});
