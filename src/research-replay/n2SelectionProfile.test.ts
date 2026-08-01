import assert from "node:assert/strict";
import test from "node:test";
import {
  buildN2SelectionProfile,
  type N2SelectionProfileCandidate,
} from "./n2SelectionProfile";

const base = (over: Partial<N2SelectionProfileCandidate>): N2SelectionProfileCandidate => ({
  candidateId: "c1",
  canonicalRaceKey: "2026-05-01-01-01",
  betType: "exacta",
  settlementStatus: "settled",
  resolutionStatus: "resolved",
  isSourceDuplicate: false,
  payouts: [{ selection: "1-2", payoutYen: 500, lineKind: "payout" }],
  refunds: [],
  ...over,
});

test("selection profile aggregates hit/loss/refund/special/void without loss coercion", () => {
  const profile = buildN2SelectionProfile([
    base({ candidateId: "normal" }),
    base({
      candidateId: "partial",
      canonicalRaceKey: "2026-05-01-01-02",
      settlementStatus: "partially_refunded",
      refunds: [{ selection: "2-1", scope: "selection", refundYenPer100: 100 }],
    }),
    base({
      candidateId: "special",
      canonicalRaceKey: "2026-05-01-01-03",
      payouts: [{ selection: null, payoutYen: 70, lineKind: "special_payout" }],
    }),
    base({
      candidateId: "void",
      canonicalRaceKey: "2026-05-01-01-04",
      settlementStatus: "refunded",
      payouts: [],
      refunds: [{ selection: null, scope: "race", refundYenPer100: 100 }],
    }),
  ]);

  assert.equal(profile.candidateCount, 4);
  assert.equal(profile.eligibleCandidateCount, 3);
  assert.equal(profile.selectionCount, 120);
  assert.deepEqual(profile.outcomes, {
    hit: 2,
    loss: 57,
    refund: 1,
    special_payout: 30,
    void: 30,
  });
  assert.equal(profile.byBetType.exacta.classificationRows, 59);
  assert.equal(profile.byBetType.exacta.hits, 2);
  assert.equal(profile.byBetType.exacta.hitRate, +(2 / 59).toFixed(8));
  assert.deepEqual(profile.byBetType.exacta.positivePayoutYenPer100, {
    count: 33,
    min: 70,
    p50: 70,
    p90: 70,
    p99: 500,
    max: 500,
    mean: +((500 * 2 + 100 + 70 * 30) / 33).toFixed(4),
  });
});

test("bet_type refund applies to every selection and overrides special payout", () => {
  const profile = buildN2SelectionProfile([base({
    settlementStatus: "partially_refunded",
    payouts: [{ selection: null, payoutYen: 70, lineKind: "special_payout" }],
    refunds: [{ selection: null, scope: "bet_type", refundYenPer100: 100 }],
  })]);
  assert.equal(profile.outcomes.refund, 30);
  assert.equal(profile.outcomes.special_payout, 0);
  assert.equal(profile.byBetType.exacta.classificationRows, 0);
});

test("digest is stable across DB row order but changes with label truth", () => {
  const a = base({ candidateId: "a", canonicalRaceKey: "2026-05-01-01-01" });
  const b = base({ candidateId: "b", canonicalRaceKey: "2026-05-01-01-02" });
  const first = buildN2SelectionProfile([a, b]);
  const reordered = buildN2SelectionProfile([b, a]);
  assert.equal(first.labelDigest, reordered.labelDigest);
  const changed = buildN2SelectionProfile([a, {
    ...b,
    payouts: [{ selection: "1-2", payoutYen: 600, lineKind: "payout" }],
  }]);
  assert.notEqual(first.labelDigest, changed.labelDigest);
});

test("conflicting financial truth fails closed", () => {
  assert.throws(() => buildN2SelectionProfile([base({
    payouts: [
      { selection: "1-2", payoutYen: 500, lineKind: "payout" },
      { selection: "1-2", payoutYen: 600, lineKind: "payout" },
    ],
  })]), /N2_CONFLICTING_PAYOUT/);
  assert.throws(() => buildN2SelectionProfile([base({
    payouts: [
      { selection: null, payoutYen: 70, lineKind: "special_payout" },
      { selection: null, payoutYen: 80, lineKind: "special_payout" },
    ],
  })]), /N2_CONFLICTING_SPECIAL_PAYOUT/);
  assert.throws(() => buildN2SelectionProfile([base({
    settlementStatus: "partially_refunded",
    refunds: [
      { selection: "2-1", scope: "selection", refundYenPer100: 100 },
      { selection: "2-1", scope: "selection", refundYenPer100: 70 },
    ],
  })]), /N2_CONFLICTING_REFUND/);
});
