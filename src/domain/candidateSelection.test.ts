import assert from "node:assert/strict";
import test from "node:test";
import { selectTopModelCandidatePerRace } from "./candidateSelection";
import type { BetCandidate } from "./types";

function candidate(raceId: string, selection: [number, number, number], score: number): BetCandidate {
  return {
    raceId,
    date: "2026-07-18",
    venue: "蒲郡",
    raceNo: 1,
    closeAt: "12:00",
    betType: "3連単",
    selection,
    estimatedHitRate: score,
    modelSelectionScore: score,
    sampleSize: 100,
    currentOdds: 10,
    targetEv: 1.25,
    suggestedAmount: 100,
    source: "test",
    fetchedAt: "2026-07-18T00:00:00Z",
  };
}

test("同一レースの全出目からモデル最上位1件だけを選ぶ", () => {
  const rows = selectTopModelCandidatePerRace([
    candidate("race-1", [1, 2, 3], 0.08),
    candidate("race-1", [6, 5, 4], 0.001),
    candidate("race-1", [1, 3, 2], 0.05),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].selection, [1, 2, 3]);
});

test("レース順を維持して各レース1件を返す", () => {
  const rows = selectTopModelCandidatePerRace([
    candidate("race-2", [6, 5, 4], 0.001),
    candidate("race-1", [1, 2, 3], 0.08),
    candidate("race-2", [1, 2, 3], 0.07),
  ]);
  assert.deepEqual(rows.map((row) => [row.raceId, row.selection.join("-")]), [
    ["race-2", "1-2-3"],
    ["race-1", "1-2-3"],
  ]);
});
