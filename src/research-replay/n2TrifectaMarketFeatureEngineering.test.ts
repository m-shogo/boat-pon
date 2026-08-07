import assert from "node:assert/strict";
import test from "node:test";

import {
  buildN2TrifectaMarketRaceFeatureSequence,
  buildN2TrifectaMarketSnapshotFeatures,
  buildN2TrifectaMarketTransitionFeatures,
  type N2TrifectaMarketCheckpointLabel,
  type N2TrifectaMarketSnapshotInput,
} from "./n2TrifectaMarketFeatureEngineering";

function selections(): string[] {
  const out: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        out.push(`${first}-${second}-${third}`);
      }
    }
  }
  return out;
}

function oddsMap(mutator?: (selection: string, index: number, odds: number) => number): Map<string, number> {
  return new Map(
    selections().map((selection, index) => {
      const base = 2 + index * 0.1;
      return [selection, mutator ? mutator(selection, index, base) : base] as const;
    }),
  );
}

function snapshot(
  checkpointLabel: N2TrifectaMarketCheckpointLabel,
  odds: ReadonlyMap<string, number> = oddsMap(),
  capturedAt = "2026-08-07T01:00:30.000Z",
): N2TrifectaMarketSnapshotInput {
  return {
    raceIdentity: "20260807-05-01",
    checkpointLabel,
    capturedAt,
    availableAt: "2026-08-07T01:00:00.000Z",
    odds,
  };
}

function approximately(actual: number, expected: number, tolerance = 1e-10): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("snapshot features normalize the complete 120-selection inverse-odds market", () => {
  const result = buildN2TrifectaMarketSnapshotFeatures(snapshot("T-30"));
  assert.equal(result.status, "PASS");
  assert.ok(result.snapshot);
  const feature = result.snapshot;
  assert.equal(feature.selectionCount, 120);
  assert.equal(feature.selections.length, 120);
  assert.equal(feature.favoriteSelection, "1-2-3");
  assert.equal(feature.favoriteOdds, 2);
  assert.equal(feature.secondFavoriteOdds, 2.1);
  assert.ok(feature.favoriteGapRatio > 1);
  approximately(
    feature.selections.reduce((sum, row) => sum + row.marketMassShare, 0),
    1,
  );
  assert.ok(feature.normalizedEntropy > 0 && feature.normalizedEntropy <= 1);
  assert.ok(feature.effectiveSelectionCount > 1 && feature.effectiveSelectionCount <= 120);
  assert.ok(feature.herfindahlIndex > 0 && feature.herfindahlIndex <= 1);
  assert.ok(feature.top1MassShare < feature.top3MassShare);
  assert.ok(feature.top3MassShare < feature.top5MassShare);
  assert.ok(feature.top5MassShare < feature.top10MassShare);
  assert.ok(feature.oddsP10 < feature.oddsMedian);
  assert.ok(feature.oddsMedian < feature.oddsP90);
  assert.equal(feature.privateResearchOnly, true);
  assert.equal(feature.publicPublishAuthorized, false);
  assert.equal(feature.databaseWriteAuthorized, false);
  assert.match(feature.outputDigest, /^[0-9a-f]{64}$/u);
});

test("snapshot blocks incomplete or invalid selection universes", () => {
  const incomplete = oddsMap();
  incomplete.delete("6-5-4");
  const missing = buildN2TrifectaMarketSnapshotFeatures(snapshot("T-30", incomplete));
  assert.equal(missing.status, "BLOCKED");
  assert.ok(missing.blockers.includes("SELECTION_COUNT_NOT_120"));
  assert.ok(missing.blockers.includes("SELECTION_UNIVERSE_INCOMPLETE"));

  const invalid = oddsMap();
  invalid.set("1-2-3", 0);
  const zero = buildN2TrifectaMarketSnapshotFeatures(snapshot("T-30", invalid));
  assert.equal(zero.status, "BLOCKED");
  assert.ok(zero.blockers.includes("ODDS_NOT_POSITIVE_FINITE"));
});

test("transition features quantify steam, rank movement and distribution shift", () => {
  const beforeResult = buildN2TrifectaMarketSnapshotFeatures(snapshot("T-30"));
  const afterOdds = oddsMap((selection, _index, odds) => selection === "6-5-4" ? 1.1 : odds);
  const afterResult = buildN2TrifectaMarketSnapshotFeatures(
    snapshot("T-20", afterOdds, "2026-08-07T01:10:30.000Z"),
  );
  assert.ok(beforeResult.snapshot && afterResult.snapshot);
  const transition = buildN2TrifectaMarketTransitionFeatures(
    beforeResult.snapshot,
    afterResult.snapshot,
  );
  assert.equal(transition.fromCheckpoint, "T-30");
  assert.equal(transition.toCheckpoint, "T-20");
  assert.equal(transition.checkpointStepsApart, 1);
  assert.equal(transition.capturedSecondsApart, 600);
  assert.equal(transition.favoriteChanged, true);
  assert.ok(transition.jensenShannonDivergenceBits > 0);
  assert.ok(transition.totalVariationDistance > 0);
  assert.ok(transition.maxAbsoluteLogOddsMove > 0);
  assert.equal(transition.shorteningSelectionCount, 1);
  assert.equal(transition.lengtheningSelectionCount, 0);
  assert.equal(transition.unchangedSelectionCount, 119);
  const moved = transition.moves.find((row) => row.selection === "6-5-4");
  assert.ok(moved);
  assert.ok(moved.rankImprovement > 0);
  assert.ok(moved.logOddsRatio < 0);
  assert.ok(moved.marketMassShareDelta > 0);
});

test("race sequence preserves partial checkpoints and explicit gap distance", () => {
  const sequence = buildN2TrifectaMarketRaceFeatureSequence([
    snapshot("T-30"),
    snapshot("T-10", oddsMap((selection, _index, odds) => selection === "1-2-3" ? 1.8 : odds), "2026-08-07T01:20:30.000Z"),
  ]);
  assert.equal(sequence.status, "PARTIAL");
  assert.deepEqual(sequence.availableCheckpoints, ["T-30", "T-10"]);
  assert.deepEqual(sequence.missingCheckpoints, ["T-20", "T-5"]);
  assert.equal(sequence.transitions.length, 1);
  assert.equal(sequence.transitions[0].checkpointStepsApart, 2);
  assert.equal(sequence.privateResearchOnly, true);
  assert.equal(sequence.publicPublishAuthorized, false);
  assert.equal(sequence.databaseWriteAuthorized, false);
});

test("race sequence blocks mixed race identities and duplicate checkpoints", () => {
  const mixed = buildN2TrifectaMarketRaceFeatureSequence([
    snapshot("T-30"),
    { ...snapshot("T-20"), raceIdentity: "20260807-05-02" },
  ]);
  assert.equal(mixed.status, "BLOCKED");
  assert.ok(mixed.blockers.includes("SEQUENCE_RACE_IDENTITY_MISMATCH"));

  const duplicate = buildN2TrifectaMarketRaceFeatureSequence([
    snapshot("T-30"),
    snapshot("T-30", oddsMap((_selection, _index, odds) => odds * 1.01), "2026-08-07T01:00:45.000Z"),
  ]);
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.blockers.includes("SEQUENCE_DUPLICATE_CHECKPOINT"));
});
