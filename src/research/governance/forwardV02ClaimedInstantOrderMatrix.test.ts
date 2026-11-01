import assert from "node:assert/strict";
import test from "node:test";
import {
  compareForwardV02ClaimedInstants,
  validForwardV02ClaimedInstant,
} from "./forwardV02ClaimedInstant";

/**
 * Deterministic synthetic chronology matrix: ranks are specified independently
 * of Date.parse and of the implementation's fraction-normalization algorithm.
 * Claimed timestamps are untrusted metadata, never authenticated clock evidence.
 */
const instants = [
  { claimed: "2026-12-31T23:59:59.999999999Z", rank: 1 },
  { claimed: "2027-01-01T08:59:59.999999999+09:00", rank: 1 },
  { claimed: "2027-01-01T00:00:00Z", rank: 2 },
  { claimed: "2026-12-31T19:00:00-05:00", rank: 2 },
  { claimed: "2027-01-01T00:00:00.000000000Z", rank: 2 },
  { claimed: "2027-01-01T00:00:00.000000001Z", rank: 3 },
  { claimed: "2027-01-01T09:00:00.000000001+09:00", rank: 3 },
  { claimed: "2027-01-01T00:00:00.00000001Z", rank: 4 },
  { claimed: "2027-01-01T00:00:00.000000010Z", rank: 4 },
  { claimed: "2027-01-01T00:00:00.0000001Z", rank: 5 },
  { claimed: "2027-01-01T00:00:00.000001Z", rank: 6 },
  { claimed: "2027-01-01T00:00:00.001Z", rank: 7 },
  { claimed: "2027-01-01T00:00:01Z", rank: 8 },
  { claimed: "2027-01-01T01:00:01+01:00", rank: 8 },
] as const;

test("claimed-instant matrix admits each synthetic known-offset instant", () => {
  for (const item of instants) {
    assert.equal(validForwardV02ClaimedInstant(item.claimed), true, item.claimed);
  }
});

test("claimed-instant ordering matches independent UTC/fraction ranks for every pair", () => {
  for (const left of instants) {
    for (const right of instants) {
      const actual = compareForwardV02ClaimedInstants(left.claimed, right.claimed);
      const expected = Math.sign(left.rank - right.rank);
      assert.equal(Math.sign(actual), expected, left.claimed + " vs " + right.claimed);
      assert.equal(
        Math.sign(compareForwardV02ClaimedInstants(right.claimed, left.claimed)),
        -expected,
        "antisymmetry: " + left.claimed + " vs " + right.claimed,
      );
    }
  }
});

test("claimed-instant ordering remains transitive across offset and precision triples", () => {
  for (const first of instants) {
    for (const second of instants) {
      if (first.rank > second.rank) continue;
      for (const third of instants) {
        if (second.rank > third.rank) continue;
        assert.ok(
          compareForwardV02ClaimedInstants(first.claimed, third.claimed) <= 0,
          "transitivity: " + first.claimed + " <= " + second.claimed + " <= " + third.claimed,
        );
      }
    }
  }
});
