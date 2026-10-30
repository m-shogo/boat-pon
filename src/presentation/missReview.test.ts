import assert from "node:assert/strict";
import test from "node:test";
import { poissonBinomialLowerTail, buildMissReview, type MissReviewRow } from "./missReview";

let nextId = 0;
const row = (overrides: Partial<MissReviewRow> = {}): MissReviewRow => ({
  id: ++nextId, raceId: `r${nextId}`, venue: "常滑", raceNo: 1, betType: "3連単", selection: "1-2-3", result: "1-2-3",
  returned: 0, officialReturned: 0, estimatedHitRate: .1, currentOdds: 20, ev: 2,
  recommendedStakeYen: 300, actuallyBought: 0, stakeYen: 0, modelVersion: "test", runKind: "paper-live",
  payoutMatches: 1, officialPayoutYen: 1000, validPayoutRows: 1, ...overrides,
});
const review = (rows: MissReviewRow[]) => buildMissReview(rows, "2026-10-01", "2026-10-30");
const miss = (overrides: Partial<MissReviewRow> = {}) => row({ result: "2-1-3", payoutMatches: 0, officialPayoutYen: null, ...overrides });

test("Poisson binomial DP uses unequal probabilities and handles endpoints", () => {
  assert.equal(poissonBinomialLowerTail([], 0), 1);
  assert.ok(Math.abs(poissonBinomialLowerTail([.1, .8], 0) - .18) < 1e-14);
  assert.ok(Math.abs(poissonBinomialLowerTail([.1, .8], 1) - .92) < 1e-14);
  assert.equal(poissonBinomialLowerTail([0, 1], 0), 0);
  assert.equal(poissonBinomialLowerTail([0, 1], 1), 1);
  assert.throws(() => poissonBinomialLowerTail([.5], 2));
  assert.throws(() => poissonBinomialLowerTail([NaN], 0));
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
  for (const bad of [row({ officialPayoutYen: null }), row({ payoutMatches: 2 })]) {
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

test("duplicate tickets use latest id once even with reverse input order", () => {
  const older = miss({ id: 10, raceId: "duplicate", estimatedHitRate: .8, modelVersion: "old" });
  const latest = miss({ id: 11, raceId: "duplicate", estimatedHitRate: .2, modelVersion: "latest" });
  const report = review([latest, older]);
  assert.equal(report.queriedBuyCount, 2);
  assert.equal(report.deduplicatedBuyCount, 1);
  assert.equal(report.summary.count, 1);
  assert.equal(report.summary.expectedHits, .2);
  assert.equal(report.summary.lowerTailProbability, .8);
  assert.equal(report.money.paper.investedYen, 300);
  assert.deepEqual(report.cohorts.map((r) => [r.label, r.count]), [["latest / paper-live", 1]]);
});

test("different tickets in one race sum probabilities before race-level DP", () => {
  const report = review([
    miss({ raceId: "same", selection: "1-2-3", estimatedHitRate: .2 }),
    miss({ raceId: "same", selection: "1-3-2", estimatedHitRate: .3 }),
    miss({ raceId: "other", estimatedHitRate: .1 }),
  ]);
  assert.equal(report.summary.count, 3);
  assert.deepEqual(report.raceSummary, { count: 2, hits: 0, expectedHits: .6 });
  assert.ok(Math.abs(report.summary.lowerTailProbability! - .45) < 1e-14);
  const capped = review([row({ raceId: "same", estimatedHitRate: .8 }), row({ raceId: "same", betType: "3連複", selection: "1-2-3", estimatedHitRate: .8 })]);
  assert.deepEqual(capped.raceSummary, { count: 1, hits: 1, expectedHits: 1 });
  assert.equal(capped.summary.lowerTailProbability, 1);
});

test("confirmed losses with no race_payouts settle at zero ROI", () => {
  const report = review([miss({ validPayoutRows: 0, actuallyBought: 1, stakeYen: 100 })]);
  for (const money of [report.money.paper, report.money.actual]) {
    assert.equal(money.payoutYen, 0);
    assert.equal(money.roi, 0);
    assert.equal(money.missingPayouts, 0);
  }
});
