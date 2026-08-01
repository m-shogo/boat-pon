import assert from "node:assert/strict";
import test from "node:test";
import { extractProgramFeatures, featureAdjustmentForSelection } from "./programFeatures";

test("番組表raw_jsonから艇特徴量を抽出する", () => {
  const features = extractProgramFeatures({
    boats: [
      { course: 1, registrationNo: "1234", racerName: "テスト 太郎", className: "A1", nationalWinRate: 7.2, motorTop2Rate: 42.1 },
    ],
  });
  assert.equal(features.boats[0].course, 1);
  assert.equal(features.boats[0].className, "A1");
});

test("1着艇の選手/モーター特徴量で推定率を保守的に補正する", () => {
  const strong = extractProgramFeatures({
    boats: [{ course: 1, className: "A1", nationalWinRate: 7.4, localWinRate: 7.0, motorTop2Rate: 45, boatTop2Rate: 42 }],
  });
  const weak = extractProgramFeatures({
    boats: [{ course: 1, className: "B2", nationalWinRate: 3.4, localWinRate: 3.8, motorTop2Rate: 20, boatTop2Rate: 22 }],
  });
  assert.ok(featureAdjustmentForSelection(strong, [1, 2, 3]) > 1);
  assert.ok(featureAdjustmentForSelection(weak, [1, 2, 3]) < 1);
});

test("欠損rateを0へ変換せずnullのまま保持する", () => {
  const features = extractProgramFeatures({
    boats: [{
      course: 1,
      nationalWinRate: null,
      nationalTop2Rate: "",
      localWinRate: undefined,
      localTop2Rate: "   ",
      motorTop2Rate: "not-a-number",
      boatTop2Rate: 0,
    }],
  });
  assert.deepEqual(features.boats[0], {
    course: 1,
    registrationNo: undefined,
    racerName: undefined,
    className: undefined,
    nationalWinRate: null,
    nationalTop2Rate: null,
    localWinRate: null,
    localTop2Rate: null,
    motorNo: undefined,
    motorTop2Rate: null,
    boatNo: undefined,
    boatTop2Rate: 0,
  });
});
