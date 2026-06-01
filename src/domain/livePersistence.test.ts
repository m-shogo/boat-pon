import assert from "node:assert/strict";
import test from "node:test";
import { isWithinOddsFetchWindow, minutesUntilRaceClose, oddsCheckpointLabel, shouldPersistDecisionHistory } from "./livePersistence";

const rule = { minMinutesBeforeClose: 5 };
const liveFrom = "2026-01-01";

test("minutesUntilRaceCloseは日付込みで締切後を負数にする", () => {
  const now = new Date("2026-05-26T12:10:00+09:00");
  assert.equal(minutesUntilRaceClose("2026-05-26", "12:00", now), -10);
});

test("isWithinOddsFetchWindowは締切前5-30分だけtrueにする", () => {
  assert.equal(isWithinOddsFetchWindow({ date: "2026-05-26", closeAt: "12:00" }, rule, new Date("2026-05-26T11:40:00+09:00")), true);
  assert.equal(isWithinOddsFetchWindow({ date: "2026-05-26", closeAt: "12:00" }, rule, new Date("2026-05-26T11:20:00+09:00")), false);
  assert.equal(isWithinOddsFetchWindow({ date: "2026-05-26", closeAt: "12:00" }, rule, new Date("2026-05-26T11:58:00+09:00")), false);
  assert.equal(isWithinOddsFetchWindow({ date: "2026-05-26", closeAt: "12:00" }, rule, new Date("2026-05-26T12:10:00+09:00")), false);
});

test("shouldPersistDecisionHistoryはライブ日のオッズ未取得・時間外候補を保存しない", () => {
  const now = new Date("2026-05-26T10:00:00+09:00");
  assert.equal(shouldPersistDecisionHistory({ date: "2025-12-31", closeAt: "12:00", currentOdds: null }, rule, liveFrom, now), true);
  assert.equal(shouldPersistDecisionHistory({ date: "2026-05-26", closeAt: "12:00", currentOdds: 25 }, rule, liveFrom, now), true);
  assert.equal(shouldPersistDecisionHistory({ date: "2026-05-26", closeAt: "12:00", currentOdds: null }, rule, liveFrom, now), false);
  assert.equal(shouldPersistDecisionHistory({ date: "2026-05-26", closeAt: "10:20", currentOdds: null }, rule, liveFrom, now), true);
});

test("oddsCheckpointLabelは締切までの分数を時系列スナップショットラベルに丸める", () => {
  assert.equal(oddsCheckpointLabel(5), "T-5");
  assert.equal(oddsCheckpointLabel(6), "T-5");
  assert.equal(oddsCheckpointLabel(10), "T-10");
  assert.equal(oddsCheckpointLabel(20), "T-20");
  assert.equal(oddsCheckpointLabel(30), "T-30");
  assert.equal(oddsCheckpointLabel(45), "ad-hoc");
});
