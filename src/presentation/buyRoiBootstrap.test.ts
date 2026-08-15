import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapRoi95 } from "./buyRoiBootstrap";

test("bootstrap ROI is deterministic and order invariant", () => {
  const a = bootstrapRoi95([0, 0, 2, 0, 4, 0], 2000);
  const b = bootstrapRoi95([4, 0, 0, 2, 0, 0], 2000);
  assert.deepEqual(a, b);
  assert.equal(a.pointEstimate, 1);
  assert.equal(a.classification, "CROSSES_BREAK_EVEN");
});

test("bootstrap ROI classifies clearly losing and winning observed distributions", () => {
  const losing = bootstrapRoi95(Array.from({ length: 30 }, () => 0.5), 2000);
  const winning = bootstrapRoi95(Array.from({ length: 30 }, () => 1.5), 2000);
  assert.equal(losing.lower, 0.5);
  assert.equal(losing.upper, 0.5);
  assert.equal(losing.classification, "BELOW_BREAK_EVEN");
  assert.equal(winning.lower, 1.5);
  assert.equal(winning.upper, 1.5);
  assert.equal(winning.classification, "ABOVE_BREAK_EVEN");
});

test("bootstrap ROI exposes heavy-tail uncertainty instead of trusting the point estimate", () => {
  const values = [...Array.from({ length: 58 }, () => 0), 10, 60];
  const interval = bootstrapRoi95(values, 5000);
  assert.ok(interval.pointEstimate > 1);
  assert.ok(interval.lower < 1);
  assert.ok(interval.upper > 1);
  assert.equal(interval.classification, "CROSSES_BREAK_EVEN");
  assert.equal(interval.breakEven, 1);
  assert.equal(interval.confidenceLevel, 0.95);
});

test("bootstrap ROI rejects invalid inputs", () => {
  assert.throws(() => bootstrapRoi95([], 2000), /requires at least one settled outcome/u);
  assert.throws(() => bootstrapRoi95([0, Number.NaN], 2000), /finite and non-negative/u);
  assert.throws(() => bootstrapRoi95([0, 1], 999), /iterations/u);
});
