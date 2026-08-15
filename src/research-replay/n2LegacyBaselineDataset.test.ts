import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import {
  N2_LEGACY_MODEL_ALPHA,
  N2_LEGACY_MODEL_VERSION,
  assertLegacySurfaceMatchesCurrentModel,
  buildN2LegacyBaselineDataset,
  type N2LegacyBaselineDataset,
} from "./n2LegacyBaselineDataset";
import type {
  N2HistoricalEvaluationRace,
  N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";

const selections = enumerateBetSelections("trifecta");

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function training(): N2HistoricalOutcomeRow[] {
  return Array.from({ length: 175 }, (_, index) => ({
    canonicalRaceKey: `${isoDate("2026-08-07", index - 175)}:05:R1`,
    winningSelection: selections[index % 17],
  }));
}

function evaluationRaces(): N2HistoricalEvaluationRace[] {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      canonicalRaceKey: `2026-08-07:05:R${index + 1}`,
      winningSelection: selections[index],
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      canonicalRaceKey: `2026-08-08:05:R${index + 1}`,
      winningSelection: selections[index + 12],
    })),
  ];
}

function cutoffs(races = evaluationRaces()): Record<string, string> {
  return Object.fromEntries(races.map((race) => [
    race.canonicalRaceKey,
    `${race.canonicalRaceKey.slice(0, 10)}T03:30:00.000Z`,
  ]));
}

function build(): N2LegacyBaselineDataset {
  return buildN2LegacyBaselineDataset({
    training: training(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  });
}

test("legacy probability surface numerically matches current buildVenueModel for observed selections", () => {
  const compatibility = assertLegacySurfaceMatchesCurrentModel({
    training: training(),
    venueCode: "05",
  });
  assert.ok(compatibility.matchedObservedSelectionCount > 0);
  assert.deepEqual(compatibility.mismatches, []);
  assert.equal(N2_LEGACY_MODEL_ALPHA, 15);
  assert.match(N2_LEGACY_MODEL_VERSION, /^boatpon-/u);
});

test("legacy baseline reconstructs all 120 selections for the same 20-race cohort", () => {
  const dataset = build();
  assert.equal(dataset.status, "PASS");
  assert.deepEqual(dataset.blockers, []);
  assert.equal(dataset.cohortRaceCount, 20);
  assert.equal(dataset.rowCount, 2400);
  assert.equal(dataset.positiveCount, 20);
  assert.equal(dataset.evaluation.status, "PASS");
  assert.equal(dataset.evaluation.splitCounts.forward_shadow, 2400);
  assert.equal(dataset.trainingProfiles.length, 20);
  assert.ok(dataset.rows.every((row) => row.baselineKind === "legacy"));
  assert.ok(dataset.rows.every((row) => row.decisionCutoff.endsWith("T03:30:00.000Z")));
  assert.ok(dataset.rows.every((row) => Date.parse(row.predictionAvailableAt) <= Date.parse(row.decisionCutoff)));
  for (const race of evaluationRaces()) {
    const raceRows = dataset.rows.filter((row) => row.canonicalRaceKey === race.canonicalRaceKey);
    assert.equal(raceRows.length, 120);
    assert.equal(raceRows.reduce((sum, row) => sum + row.hit, 0), 1);
  }
});

test("legacy replay snapshots are deterministic and immutable per evaluation race", () => {
  const first = build();
  const second = build();
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(
    first.trainingProfiles.map((profile) => profile.decisionSnapshotId),
    second.trainingProfiles.map((profile) => profile.decisionSnapshotId),
  );
  assert.ok(first.trainingProfiles.every((profile) => /^legacy-replay:[0-9a-f]{64}$/u.test(profile.decisionSnapshotId)));
});

test("legacy baseline excludes same-day outcomes from training", () => {
  const evals = evaluationRaces();
  const dataset = buildN2LegacyBaselineDataset({
    training: [...training(), ...evals],
    evaluationRaces: evals,
    decisionCutoffByRaceKey: cutoffs(evals),
  });
  assert.equal(dataset.status, "PASS");
  const aug7 = dataset.trainingProfiles.filter((profile) => profile.trainingToDateExclusive === "2026-08-07");
  const aug8 = dataset.trainingProfiles.filter((profile) => profile.trainingToDateExclusive === "2026-08-08");
  assert.ok(aug7.every((profile) => profile.venueTrainingRaceCount === training().length));
  assert.ok(aug8.every((profile) => profile.venueTrainingRaceCount === training().length + 12));
});

test("legacy baseline blocks on insufficient venue history", () => {
  const dataset = buildN2LegacyBaselineDataset({
    training: training().slice(0, 29),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.some((blocker) => blocker.includes("VENUE_TRAINING_TOO_SMALL:05:29/30")));
  assert.equal(dataset.rowCount, 0);
});

test("legacy baseline blocks if exact T-5 cutoff metadata is incomplete", () => {
  const map = cutoffs();
  delete map["2026-08-07:05:R1"];
  const dataset = buildN2LegacyBaselineDataset({
    training: training(),
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: map,
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.includes("2026-08-07:05:R1:DECISION_CUTOFF_MISSING_OR_INVALID"));
  assert.equal(dataset.rowCount, 0);
});

test("legacy baseline rejects impossible calendar dates in training history", () => {
  const invalidTraining = [...training(), {
    canonicalRaceKey: "2026-02-30:05:R1",
    winningSelection: selections[0],
  }];
  const dataset = buildN2LegacyBaselineDataset({
    training: invalidTraining,
    evaluationRaces: evaluationRaces(),
    decisionCutoffByRaceKey: cutoffs(),
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.includes("2026-02-30:05:R1:TRAINING_RACE_KEY_INVALID"));
  assert.equal(dataset.rowCount, 0);
});
