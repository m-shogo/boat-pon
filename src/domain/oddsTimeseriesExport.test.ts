import assert from "node:assert/strict";
import test from "node:test";
import { groupOddsTimeseriesRows } from "./oddsTimeseriesExport";

test("同じレース・取得時刻・取得元の行を1回の取得にまとめ、行数を失わない", () => {
  const row = (raceId: string, capturedAt: string, selection: string, odds: number, popularity: number | null = null, source = "official") => ({
    race_id: raceId, selection, odds, popularity, source, captured_at: capturedAt, minutes_before_close: 5, checkpoint_label: "T-5",
  });
  const rows = [
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-2-3", 75.4, 12),
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-3-2", 40.1),
    row("20261015-芦屋-06", "2026-10-15T01:43:00Z", "1-2-3", 80.0),
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-2-3", 70.0, null, "official-early"),
    row("20261015-芦屋-01", "2026-10-15T00:10:00Z", "1-2-3", 5.5),
  ];
  const captures = groupOddsTimeseriesRows(rows);
  assert.equal(captures.length, 4);
  assert.deepEqual(captures.map((c) => [c.raceId, c.capturedAt, c.source]), [
    ["20261015-芦屋-01", "2026-10-15T00:10:00Z", "official"],
    ["20261015-芦屋-06", "2026-10-15T01:43:00Z", "official"],
    ["20261015-芦屋-06", "2026-10-15T01:53:00Z", "official"],
    ["20261015-芦屋-06", "2026-10-15T01:53:00Z", "official-early"],
  ]);
  assert.deepEqual(captures[2].odds, { "1-2-3": 75.4, "1-3-2": 40.1 });
  assert.deepEqual(captures[2].popularity, { "1-2-3": 12 });
  assert.equal(captures[1].popularity, undefined);
  assert.equal(captures.reduce((n, c) => n + Object.keys(c.odds).length, 0), rows.length);
});
