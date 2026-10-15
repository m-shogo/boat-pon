import assert from "node:assert/strict";
import test from "node:test";
import { canonicalOddsTimeseriesRows, expandOddsTimeseriesCaptures, groupOddsTimeseriesRows } from "./oddsTimeseriesExport";

const row = (raceId: string, capturedAt: string, selection: string, odds: number, popularity: number | null = null, source = "official") => ({
  race_id: raceId, selection, odds, popularity, source, captured_at: capturedAt, minutes_before_close: 5, checkpoint_label: "T-5",
});

test("同じレース・取得時刻・取得元の行を1回の取得にまとめ、並び順はレース・時刻の順", () => {
  const rows = [
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-2-3", 75.4, 12),
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-3-2", 40.1),
    row("20261015-芦屋-06", "2026-10-15T01:43:00Z", "1-2-3", 80.0),
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-2-3", 70.0, null, "official-early"),
    row("20261015-芦屋-01", "2026-10-15T00:10:00Z", "1-2-3", 5.5),
  ];
  const captures = groupOddsTimeseriesRows(rows);
  assert.deepEqual(captures.map((c) => [c.raceId, c.capturedAt, c.source, c.rows.length]), [
    ["20261015-芦屋-01", "2026-10-15T00:10:00Z", "official", 1],
    ["20261015-芦屋-06", "2026-10-15T01:43:00Z", "official", 1],
    ["20261015-芦屋-06", "2026-10-15T01:53:00Z", "official", 2],
    ["20261015-芦屋-06", "2026-10-15T01:53:00Z", "official-early", 1],
  ]);
  assert.deepEqual(captures[2].rows, [["1-2-3", 75.4, 12], ["1-3-2", 40.1, null]]);
});

test("同じ取得・同じ買い目の重複行も捨てずに残し、元の行に戻せる（Codex のレビューの指摘）", () => {
  const rows = [
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-2-3", 75.4, 12),
    row("20261015-芦屋-06", "2026-10-15T01:53:00Z", "1-2-3", 76.0, null),
  ];
  const captures = groupOddsTimeseriesRows(rows);
  assert.equal(captures[0].rows.length, 2);
  assert.equal(canonicalOddsTimeseriesRows(expandOddsTimeseriesCaptures(captures)), canonicalOddsTimeseriesRows(rows));
  // 値が1つでも違えば、比べる文字列も変わる
  assert.notEqual(canonicalOddsTimeseriesRows([rows[0], { ...rows[1], odds: 76.1 }]), canonicalOddsTimeseriesRows(rows));
});
