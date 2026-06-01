import assert from "node:assert/strict";
import test from "node:test";
import { calibrationB1Where, parseCalibrationB1Rule } from "./calibrationRule";

test("Calibration B1現行liveルールは2号艇B1除外を含めない", () => {
  const where = calibrationB1Where("current-live", "dh.current_odds");
  assert.match(where, /boats\[0\]\.className/);
  assert.doesNotMatch(where, /boats\[1\]\.className/);
  assert.match(where, /dh\.current_odds \/ dh\.required_odds < 1\.5/);
});

test("Calibration B1旧検証ルールはlegacy-second-not-b1として2号艇B1除外を明示する", () => {
  const where = calibrationB1Where("legacy-second-not-b1", "os.odds");
  assert.match(where, /boats\[1\]\.className'\) != 'B1'/);
  assert.match(where, /os\.odds \/ dh\.required_odds < 1\.5/);
});

test("未知のCalibration B1ルールは現行liveに倒す", () => {
  assert.equal(parseCalibrationB1Rule("legacy-second-not-b1"), "legacy-second-not-b1");
  assert.equal(parseCalibrationB1Rule("anything"), "current-live");
});
