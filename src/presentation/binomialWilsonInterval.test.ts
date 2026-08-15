import assert from "node:assert/strict";
import test from "node:test";
import { wilson95 } from "./binomialWilsonInterval";

test("computes the current 2-of-58 BUY hit-rate uncertainty without overstating precision", () => {
  assert.deepEqual(wilson95(2, 58), {
    confidenceLevel: 0.95,
    method: "WILSON_SCORE",
    trials: 58,
    successes: 2,
    pointEstimate: 0.0345,
    lower: 0.0095,
    upper: 0.1173,
    width: 0.1078,
  });
});

test("computes the recent 1-of-30 BUY interval", () => {
  assert.deepEqual(wilson95(1, 30), {
    confidenceLevel: 0.95,
    method: "WILSON_SCORE",
    trials: 30,
    successes: 1,
    pointEstimate: 0.0333,
    lower: 0.0059,
    upper: 0.1667,
    width: 0.1608,
  });
});

test("returns null estimates for zero settled evidence", () => {
  assert.deepEqual(wilson95(0, 0), {
    confidenceLevel: 0.95,
    method: "WILSON_SCORE",
    trials: 0,
    successes: 0,
    pointEstimate: null,
    lower: null,
    upper: null,
    width: null,
  });
});

test("keeps boundary intervals inside probability space and rejects invalid counts", () => {
  const zero = wilson95(0, 30);
  const all = wilson95(30, 30);
  assert.equal(zero.lower, 0);
  assert.equal(zero.upper, 0.1135);
  assert.equal(all.lower, 0.8865);
  assert.equal(all.upper, 1);
  assert.throws(() => wilson95(3, 2), /invalid Wilson success count/u);
  assert.throws(() => wilson95(-1, 10), /invalid Wilson success count/u);
  assert.throws(() => wilson95(1, -1), /invalid Wilson trial count/u);
});
