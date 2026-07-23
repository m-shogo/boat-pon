import assert from "node:assert/strict";
import test from "node:test";
import { checkpointTargetMinutes, selectRetainedCaptures, type OddsCaptureSummary } from "./oddsTimeseriesCompaction";

function capture(capturedAt: string, minutesBeforeClose: number, selectionCount = 120): OddsCaptureSummary {
  return { raceId: "race-1", checkpointLabel: "T-5", capturedAt, minutesBeforeClose, rowCount: selectionCount, selectionCount };
}

test("目標5分に最も近い完全captureと最新captureを保持する", () => {
  const rows = [capture("2026-01-01T00:00:00Z", 9), capture("2026-01-01T00:01:00Z", 5), capture("2026-01-01T00:02:00Z", 2)];
  assert.deepEqual(selectRetainedCaptures(rows).map((row) => row.minutesBeforeClose), [5, 2]);
});

test("最新が部分市場でも完全captureを失わない", () => {
  const rows = [capture("2026-01-01T00:00:00Z", 6), capture("2026-01-01T00:01:00Z", 4, 60)];
  assert.deepEqual(selectRetainedCaptures(rows).map((row) => row.selectionCount), [120, 60]);
});

test("完全captureが無ければ最新だけを保持する", () => {
  const rows = [capture("2026-01-01T00:00:00Z", 7, 60), capture("2026-01-01T00:01:00Z", 3, 60)];
  assert.deepEqual(selectRetainedCaptures(rows).map((row) => row.minutesBeforeClose), [3]);
});

test("checkpointごとの目標分数を固定する", () => {
  assert.deepEqual(["T-30", "T-20", "T-10", "T-5", null].map(checkpointTargetMinutes), [30, 20, 12, 5, 0]);
});
