import assert from "node:assert/strict";
import test from "node:test";
import { canonicalUtcTimestamp } from "./canonical";

test("canonicalUtcTimestamp requires an explicit timestamp with timezone", () => {
  assert.throws(() => canonicalUtcTimestamp("2026-08-06"), /invalid timestamp/);
  assert.throws(() => canonicalUtcTimestamp("2026-08-06T12:00:00"), /invalid timestamp/);
  assert.throws(() => canonicalUtcTimestamp("2026-08-06T24:00:00Z"), /invalid timestamp/);
  assert.throws(() => canonicalUtcTimestamp("2026-02-30T12:00:00Z"), /invalid timestamp/);
});

test("canonicalUtcTimestamp preserves valid leap-day and explicit-offset instants", () => {
  assert.equal(
    canonicalUtcTimestamp("2028-02-29T21:00:00+09:00"),
    "2028-02-29T12:00:00.000Z",
  );
  assert.equal(
    canonicalUtcTimestamp("2026-08-06T12:00:00Z"),
    "2026-08-06T12:00:00.000Z",
  );
});
