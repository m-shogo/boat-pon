import assert from "node:assert/strict";
import test from "node:test";
import { binomialLowerTail, buildMissReview, type MissReviewRow } from "./missReview";

const row = (overrides: Partial<MissReviewRow> = {}): MissReviewRow => ({
  raceId: "r1", venue: "常滑", raceNo: 1, betType: "3連単", selection: "1-2-3", result: "1-2-3",
  returned: 0, officialReturned: 0, estimatedHitRate: .1, currentOdds: 20, ev: 2,
  recommendedStakeYen: 300, actuallyBought: 0, stakeYen: 0, modelVersion: "test", runKind: "paper-live",
  payoutMatches: 1, officialPayoutYen: 1000, validPayoutRows: 1, ...overrides,
});
const review = (rows: MissReviewRow[]) => buildMissReview(rows, "2026-10-01", "2026-10-30");
const miss = (overrides: Partial<MissReviewRow> = {}) => row({ result: "2-1-3", payoutMatches: 0, officialPayoutYen: null, ...overrides });

test("binomial CDF matches exact enumeration and remains stable for large n", () => {
  assert.equal(binomialLowerTail(0, 0, .5), 1);
  assert.ok(Math.abs(binomialLowerTail(4, 1, .5) - 5 / 16) < 1e-14);
  assert.ok(Math.abs(binomialLowerTail(10, 0, .2) - .8 ** 10) < 1e-14);
  assert.equal(binomialLowerTail(4, 2, 0), 1);
  assert.equal(binomialLowerTail(4, 2, 1), 0);
  assert.equal(binomialLowerTail(4, 4, 1), 1);
  assert.ok(Math.abs(binomialLowerTail(10000, 5000, .5) - .5039893230696916) < 1e-9);
  assert.throws(() => binomialLowerTail(2, 3, .5));
});

test("official per-100-yen payout and recorded stakes stay separate from odds and purchases", () => {
  const report = review([row({ actuallyBought: 1, stakeYen: 200 }), miss({ recommendedStakeYen: 100 })]);
  assert.deepEqual({ ...report.summary, lowerTailProbability: undefined }, { count: 2, hits: 1, expectedHits: .2, invalidProbabilities: 0, lowerTailProbability: undefined, judgement: "想定の範囲内" });
  assert.ok(Math.abs(report.summary.lowerTailProbability! - .99) < 1e-14);
  assert.equal(report.money.paper.investedYen, 400);
  assert.equal(report.money.paper.payoutYen, 3000);
  assert.equal(report.money.paper.roi, 7.5);
  assert.equal(report.money.paper.currentOddsRoi, 15);
  assert.equal(report.money.actual.investedYen, 200);
  assert.equal(report.money.actual.payoutYen, 2000);
});

test("missing/duplicate official payouts never fall back to current odds", () => {
  for (const bad of [row({ officialPayoutYen: null }), row({ payoutMatches: 2 }), miss({ validPayoutRows: 0 })]) {
    const report = review([bad]);
    assert.equal(report.money.paper.payoutYen, null);
    assert.equal(report.money.paper.roi, null);
    assert.equal(report.money.paper.missingPayouts, 1);
  }
  assert.equal(review([row({ recommendedStakeYen: -1 })]).money.paper.roi, null);
  assert.equal(review([row({ recommendedStakeYen: 0 })]).money.paper.roi, null);
});

test("empty, pending, returned, unsupported and invalid probability samples are explicit", () => {
  const report = review([row({ result: null }), row({ returned: 1 }), row({ officialReturned: 1 }), row({ betType: "unknown" }), row({ selection: "1-1-2" })]);
  assert.equal(report.summary.count, 0);
  assert.equal(report.summary.lowerTailProbability, null);
  assert.equal(report.summary.judgement, "判定不可");
  assert.deepEqual(report.excluded, { pending: 1, returned: 2, unsupportedBetType: 1, invalidSelection: 1 });
  for (const p of [null, NaN, -.1, 1.1]) {
    const invalid = review([row({ estimatedHitRate: p })]);
    assert.equal(invalid.summary.expectedHits, null);
    assert.equal(invalid.summary.lowerTailProbability, null);
  }
});

test("calibration boundaries, miss ordering and small samples are reported without changing inputs", () => {
  const rows = [miss({ estimatedHitRate: 0 }), miss({ estimatedHitRate: .05, result: "1-3-2" }), miss({ estimatedHitRate: .1, result: "1-2-4" }), row({ estimatedHitRate: .2 }), row({ estimatedHitRate: 1 })];
  const before = structuredClone(rows);
  const report = review(rows);
  assert.deepEqual(report.calibration.map((r) => r.count), [1, 1, 1, 2]);
  assert.deepEqual(report.missPatterns, { first: 1, second: 1, third: 1, other: 0 });
  assert.ok(report.conditions.venue.every((r) => r.smallSample));
  assert.equal(review(Array.from({ length: 30 }, () => miss())).conditions.venue[0].smallSample, false);
  assert.deepEqual(rows, before);
  assert.equal(review(Array.from({ length: 30 }, () => miss({ estimatedHitRate: .2 }))).summary.judgement, "想定より明らかに悪い");
});

test("other supported ticket types and official tie winners are not trifecta misses", () => {
  for (const [betType, selection] of [["2連単", "1-2"], ["2連複", "2-1"], ["3連複", "3-1-2"], ["拡連複", "1-3"]]) {
    const report = review([row({ betType, selection })]);
    assert.equal(report.summary.hits, 1);
    assert.deepEqual(report.missPatterns, { first: 0, second: 0, third: 0, other: 0 });
  }
  assert.equal(review([row({ result: "1-2-4" })]).summary.hits, 1);
  assert.equal(review([miss({ betType: "exacta", selection: "4-5" })]).missPatterns.other, 1);
});
