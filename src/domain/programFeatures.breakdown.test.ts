import test from "node:test";
import assert from "node:assert/strict";
import { featureAdjustmentBreakdownForSelection, featureAdjustmentForSelection } from "./programFeatures";

test("featureAdjustmentBreakdownForSelection returns neutral values when no matching first course exists", () => {
  const breakdown = featureAdjustmentBreakdownForSelection({ boats: [] }, [1, 2, 3]);

  assert.equal(breakdown.total, 1);
  assert.equal(breakdown.classFactor, 1);
  assert.equal(breakdown.nationalFactor, 1);
  assert.equal(breakdown.localFactor, 1);
  assert.equal(breakdown.motorFactor, 1);
  assert.equal(breakdown.boatFactor, 1);
  assert.equal(breakdown.courseStFactor, 1);
  assert.equal(breakdown.courseTop3Factor, 1);
  assert.equal(breakdown.exhibitionResidualFactor, 1);
  assert.equal(breakdown.secondClassFactor, 1);
  assert.equal(breakdown.secondLocalFactor, 1);
  assert.equal(breakdown.thirdClassFactor, 1);
});

test("featureAdjustmentForSelection equals breakdown total", () => {
  const features = {
    boats: [
      {
        course: 1,
        className: "A1",
        nationalWinRate: 7,
        localWinRate: 6.5,
        motorTop2Rate: 40,
        boatTop2Rate: 38,
        courseAvgSt: 0.15,
        courseTop3Rate: 45,
        exhibitionStResidual: 0.01,
      },
      { course: 2, className: "A2", localWinRate: 6.2 },
      { course: 3, className: "B1" },
    ],
  };

  const breakdown = featureAdjustmentBreakdownForSelection(features, [1, 2, 3]);
  const total = featureAdjustmentForSelection(features, [1, 2, 3]);

  assert.equal(total, breakdown.total);
  assert.ok(breakdown.total > 1);
  assert.ok(breakdown.total <= 1.4);
});

test("featureAdjustmentBreakdownForSelection clamps very large total", () => {
  const features = {
    boats: [
      {
        course: 1,
        className: "A1",
        nationalWinRate: 20,
        localWinRate: 20,
        motorTop2Rate: 100,
        boatTop2Rate: 100,
        courseAvgSt: 0.01,
        courseTop3Rate: 100,
        exhibitionStResidual: 1,
      },
      { course: 2, className: "A1", localWinRate: 20 },
      { course: 3, className: "A1" },
    ],
  };

  const breakdown = featureAdjustmentBreakdownForSelection(features, [1, 2, 3]);

  assert.equal(breakdown.total, 1.4);
});
