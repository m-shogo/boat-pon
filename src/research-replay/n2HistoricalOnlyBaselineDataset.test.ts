import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import {
  N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT,
  N2_HISTORICAL_LOOKBACK_DAYS,
  buildN2HistoricalOnlyBaselineDataset,
  type N2HistoricalEvaluationRace,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";

const selections = enumerateBetSelections("trifecta");

function isoDate(base: string, offsetDays: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function historicalTraining(): N2HistoricalOutcomeRow[] {
  const rows: N2HistoricalOutcomeRow[] = [];
  for (let offset = -175; offset <= -1; offset += 1) {
    const date = isoDate("2026-08-07", offset);
    rows.push({
      canonicalRaceKey: `${date}:05:R1`,
      winningSelection: selections[(offset + 175) % selections.length],
    });
  }
  return rows;
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

test("historical baseline creates a normalized 120-selection distribution per race", () => {
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training: historicalTraining(),
    evaluationRaces: evaluationRaces(),
  });
  assert.equal(dataset.status, "PASS");
  assert.equal(dataset.cohortRaceCount, N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT);
  assert.equal(dataset.rowCount, 20 * 120);
  assert.equal(dataset.positiveCount, 20);
  assert.equal(dataset.evaluation.status, "PASS");
  assert.equal(dataset.evaluation.splitCounts.forward_shadow, 20 * 120);
  assert.equal(dataset.trainingProfiles.length, 20);
  for (const raceKey of evaluationRaces().map((row) => row.canonicalRaceKey)) {
    const rows = dataset.rows.filter((row) => row.canonicalRaceKey === raceKey);
    assert.equal(rows.length, 120);
    const probabilitySum = rows.reduce((sum, row) => sum + row.probability, 0);
    assert.ok(Math.abs(probabilitySum - 1) < 1e-12);
    assert.equal(rows.reduce((sum, row) => sum + row.hit, 0), 1);
    assert.ok(rows.every((row) => row.baselineKind === "historical_only"));
  }
});

test("historical training excludes same-day outcomes and never borrows evaluation labels", () => {
  const evals = evaluationRaces();
  const training = [
    ...historicalTraining(),
    ...evals.map((row) => ({ ...row })),
  ];
  const dataset = buildN2HistoricalOnlyBaselineDataset({ training, evaluationRaces: evals });
  assert.equal(dataset.status, "PASS");

  const firstDay = dataset.trainingProfiles.filter((profile) => profile.trainingToDateExclusive === "2026-08-07");
  const secondDay = dataset.trainingProfiles.filter((profile) => profile.trainingToDateExclusive === "2026-08-08");
  assert.equal(firstDay.length, 12);
  assert.equal(secondDay.length, 8);
  assert.ok(firstDay.every((profile) => profile.globalTrainingRaceCount === historicalTraining().length));
  assert.ok(secondDay.every((profile) => profile.globalTrainingRaceCount === historicalTraining().length + 12));
  assert.ok(firstDay.every((profile) => profile.trainingToRaceKeyExclusive.startsWith("2026-08-07:")));
  assert.ok(secondDay.every((profile) => profile.trainingToRaceKeyExclusive.startsWith("2026-08-08:")));
});

test("impossible training dates fail closed before PIT model construction", () => {
  const training = historicalTraining();
  training[0] = { ...training[0], canonicalRaceKey: "2026-02-30:05:R1" };
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training,
    evaluationRaces: evaluationRaces(),
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.includes("2026-02-30:05:R1:TRAINING_RACE_KEY_INVALID"));
  assert.equal(dataset.rowCount, 0);
});

test("impossible evaluation dates fail closed before cohort ordering", () => {
  const evals = evaluationRaces();
  evals[0] = { ...evals[0], canonicalRaceKey: "2026-02-30:05:R1" };
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training: historicalTraining(),
    evaluationRaces: evals,
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.includes("2026-02-30:05:R1:EVALUATION_RACE_KEY_INVALID"));
  assert.equal(dataset.rowCount, 0);
});

test("canonical leap-day historical race keys remain valid", () => {
  const training = historicalTraining();
  training[0] = { ...training[0], canonicalRaceKey: "2024-02-29:05:R1" };
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training,
    evaluationRaces: evaluationRaces(),
  });
  assert.equal(dataset.blockers.some((blocker) => blocker.includes("TRAINING_RACE_KEY_INVALID")), false);
});

test("historical baseline blocks when venue history is too small", () => {
  const training = historicalTraining().map((row, index) =>
    index < 20 ? row : { ...row, canonicalRaceKey: row.canonicalRaceKey.replace(":05:", ":06:") },
  );
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training,
    evaluationRaces: evaluationRaces(),
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.some((blocker) => blocker.includes("VENUE_TRAINING_TOO_SMALL:05:20/30")));
  assert.equal(dataset.rowCount, 0);
});

test("historical baseline blocks before 20 common-cohort races exist", () => {
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training: historicalTraining(),
    evaluationRaces: evaluationRaces().slice(0, 19),
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.deepEqual(dataset.blockers, ["EVALUATION_COHORT_TOO_SMALL:19/20"]);
});

test("training lookback is fixed at 180 days", () => {
  assert.equal(N2_HISTORICAL_LOOKBACK_DAYS, 180);
  const old = {
    canonicalRaceKey: "2025-01-01:05:R1",
    winningSelection: "1-2-3",
  };
  const dataset = buildN2HistoricalOnlyBaselineDataset({
    training: [old, ...historicalTraining()],
    evaluationRaces: evaluationRaces(),
  });
  assert.equal(dataset.status, "PASS");
  assert.ok(dataset.trainingProfiles.every((profile) => profile.trainingSnapshotDigest.length === 64));
  assert.ok(dataset.trainingProfiles.every((profile) => profile.trainingFromDateInclusive >= "2026-02-08"));
});
