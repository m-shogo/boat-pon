import assert from "node:assert/strict";
import test from "node:test";
import { filterComparableResultsForDate, getRaceRegime, raceRegimeLabel } from "./raceRegime";
import type { RaceResult } from "./types";

function row(date: string): RaceResult {
  return {
    raceId: date,
    date,
    venue: "蒲郡",
    raceNo: 1,
    trifecta: "1-2-3",
    payoutYen: 1000,
    popularity: 1,
    returned: false,
    source: "test",
    fetchedAt: date + "T00:00:00+09:00",
  };
}

test("プロペラ制度変更のレジームを日付で判定する", () => {
  assert.equal(getRaceRegime("2012-03-31").propeller, "mochipera");
  assert.equal(getRaceRegime("2012-04-12").propeller, "propeller-transition");
  assert.equal(getRaceRegime("2012-05-01").propeller, "owner-propeller");
  assert.equal(raceRegimeLabel("2026-05-23"), "貸出ペラ時代");
});

test("現代予測では持ちペラ時代と移行期を学習から外す", () => {
  const filtered = filterComparableResultsForDate([
    row("2011-12-01"),
    row("2012-04-20"),
    row("2012-05-01"),
    row("2025-01-01"),
  ], "2026-05-23");
  assert.deepEqual(filtered.map((r) => r.date), ["2012-05-01", "2025-01-01"]);
});
