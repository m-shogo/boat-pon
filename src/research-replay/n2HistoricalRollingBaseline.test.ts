import assert from "node:assert/strict";
import test from "node:test";

import { enumerateBetSelections } from "./n2DatasetContract";
import {
  buildN2HistoricalOnlyBaselineDataset,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";
import { buildN2HistoricalRollingBaseline } from "./n2HistoricalRollingBaseline";

const selections = enumerateBetSelections("trifecta");

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function historyFixture(): N2HistoricalOutcomeRow[] {
  const rows: N2HistoricalOutcomeRow[] = [];
  for (let day = 0; day < 150; day += 1) {
    const date = addDays("2020-02-01", day);
    rows.push({
      canonicalRaceKey: `${date}:05:R1`,
      winningSelection: selections[day % 17],
    });
    rows.push({
      canonicalRaceKey: `${date}:06:R1`,
      winningSelection: selections[(day + 3) % 23],
    });
  }
  rows.push({ canonicalRaceKey: "2020-07-01:05:R1", winningSelection: "1-2-3" });
  rows.push({ canonicalRaceKey: "2020-07-01:05:R2", winningSelection: "1-3-2" });
  return rows;
}

test("rolling probabilities are numerically identical to canonical N2-021 historical baseline", () => {
  const outcomes = historyFixture();
  const evaluation = { canonicalRaceKey: "2020-07-01:05:R1", winningSelection: "1-2-3" };
  const canonical = buildN2HistoricalOnlyBaselineDataset({
    training: outcomes,
    evaluationRaces: [evaluation],
    cohortRaceCount: 1,
  });
  assert.equal(canonical.status, "PASS");
  assert.equal(canonical.rows.length, 120);

  const rolling = buildN2HistoricalRollingBaseline({
    outcomes,
    requestedRaceKeys: [evaluation.canonicalRaceKey],
  });
  assert.equal(rolling.status, "PASS");
  assert.equal(rolling.baselineRaceCount, 1);
  const rolled = rolling.baselines[0];
  for (const row of canonical.rows) {
    assert.equal(
      rolled.probabilityBySelection[row.betSelection],
      row.probability,
      `probability drift for ${row.betSelection}`,
    );
  }
  assert.ok(Math.abs(rolled.probabilitySum - 1) <= 1e-12);
  assert.equal(rolled.globalTrainingRaceCount, canonical.trainingProfiles[0].globalTrainingRaceCount);
  assert.equal(rolled.venueTrainingRaceCount, canonical.trainingProfiles[0].venueTrainingRaceCount);
});

test("same-day outcomes are excluded for every race on the evaluation date", () => {
  const outcomes = historyFixture();
  const rolling = buildN2HistoricalRollingBaseline({
    outcomes,
    requestedRaceKeys: ["2020-07-01:05:R1", "2020-07-01:05:R2"],
  });
  assert.equal(rolling.status, "PASS");
  assert.equal(rolling.baselineRaceCount, 2);
  assert.equal(rolling.baselines[0].globalTrainingRaceCount, rolling.baselines[1].globalTrainingRaceCount);
  assert.equal(rolling.baselines[0].venueTrainingRaceCount, rolling.baselines[1].venueTrainingRaceCount);
  assert.equal(rolling.baselines[0].trainingCountStateDigest, rolling.baselines[1].trainingCountStateDigest);
});

test("support-only mode does not require the evaluation outcome label", () => {
  const outcomes = historyFixture().filter((row) => row.canonicalRaceKey !== "2020-07-01:05:R1");
  const rolling = buildN2HistoricalRollingBaseline({
    outcomes,
    requestedRaceKeys: ["2020-07-01:05:R1"],
    includeProbabilities: false,
  });
  assert.equal(rolling.status, "PASS");
  assert.equal(rolling.supportedRaceCount, 1);
  assert.equal(rolling.baselineRaceCount, 0);
  assert.equal(rolling.supports[0].supported, true);
});

test("probability mode fails closed when a selected evaluation race has no canonical outcome", () => {
  const outcomes = historyFixture().filter((row) => row.canonicalRaceKey !== "2020-07-01:05:R1");
  const rolling = buildN2HistoricalRollingBaseline({
    outcomes,
    requestedRaceKeys: ["2020-07-01:05:R1"],
  });
  assert.equal(rolling.status, "BLOCKED");
  assert.ok(rolling.blockers.includes("2020-07-01:05:R1:REQUEST_OUTCOME_MISSING"));
  assert.equal(rolling.baselineRaceCount, 0);
});

test("early or sparse venue candidates are reported unsupported rather than given invented priors", () => {
  const outcomes: N2HistoricalOutcomeRow[] = [];
  for (let day = 0; day < 130; day += 1) {
    const date = addDays("2020-01-01", day);
    outcomes.push({ canonicalRaceKey: `${date}:05:R1`, winningSelection: selections[day % 11] });
  }
  outcomes.push({ canonicalRaceKey: "2020-05-20:06:R1", winningSelection: "1-2-3" });
  const rolling = buildN2HistoricalRollingBaseline({
    outcomes,
    requestedRaceKeys: ["2020-05-20:06:R1"],
    includeProbabilities: false,
  });
  assert.equal(rolling.status, "PASS");
  assert.equal(rolling.supportedRaceCount, 0);
  assert.equal(rolling.unsupportedRaceCount, 1);
  assert.ok(rolling.supports[0].globalTrainingRaceCount >= 120);
  assert.equal(rolling.supports[0].venueTrainingRaceCount, 0);
});

test("rolling window drops outcomes older than exactly 180 days", () => {
  const outcomes: N2HistoricalOutcomeRow[] = [];
  for (let day = 0; day < 220; day += 1) {
    const date = addDays("2019-12-01", day);
    outcomes.push({ canonicalRaceKey: `${date}:05:R1`, winningSelection: selections[day % 13] });
  }
  const evaluationDate = addDays("2019-12-01", 220);
  outcomes.push({ canonicalRaceKey: `${evaluationDate}:05:R1`, winningSelection: "1-2-3" });
  const rolling = buildN2HistoricalRollingBaseline({
    outcomes,
    requestedRaceKeys: [`${evaluationDate}:05:R1`],
  });
  assert.equal(rolling.status, "PASS");
  assert.equal(rolling.baselines[0].globalTrainingRaceCount, 180);
  assert.equal(rolling.baselines[0].venueTrainingRaceCount, 180);
  assert.equal(rolling.baselines[0].trainingFromDateInclusive, addDays(evaluationDate, -180));
});

test("duplicate/invalid source or request keys fail closed", () => {
  const duplicateOutcomes = historyFixture();
  duplicateOutcomes.push({ ...duplicateOutcomes[0] });
  const duplicate = buildN2HistoricalRollingBaseline({
    outcomes: duplicateOutcomes,
    requestedRaceKeys: ["2020-07-01:05:R1"],
  });
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.blockers.some((blocker) => blocker.includes("DUPLICATE_OUTCOME_RACE")));

  const invalid = buildN2HistoricalRollingBaseline({
    outcomes: historyFixture(),
    requestedRaceKeys: ["bad-key"],
  });
  assert.equal(invalid.status, "BLOCKED");
  assert.ok(invalid.blockers.includes("bad-key:REQUEST_RACE_KEY_INVALID"));

  const impossibleRequest = buildN2HistoricalRollingBaseline({
    outcomes: historyFixture(),
    requestedRaceKeys: ["2020-02-30:05:R1"],
  });
  assert.equal(impossibleRequest.status, "BLOCKED");
  assert.ok(impossibleRequest.blockers.includes("2020-02-30:05:R1:REQUEST_RACE_KEY_INVALID"));
  assert.equal(impossibleRequest.baselineRaceCount, 0);

  const impossibleOutcome = buildN2HistoricalRollingBaseline({
    outcomes: [{ canonicalRaceKey: "2020-02-30:05:R1", winningSelection: "1-2-3" }],
    requestedRaceKeys: [],
  });
  assert.equal(impossibleOutcome.status, "BLOCKED");
  assert.ok(impossibleOutcome.blockers.includes("2020-02-30:05:R1:OUTCOME_RACE_KEY_INVALID"));
  assert.equal(impossibleOutcome.baselineRaceCount, 0);
});

test("rolling output is deterministic for reordered outcome and request input", () => {
  const outcomes = historyFixture();
  const requests = ["2020-07-01:05:R1", "2020-07-01:05:R2"];
  const first = buildN2HistoricalRollingBaseline({ outcomes, requestedRaceKeys: requests });
  const second = buildN2HistoricalRollingBaseline({
    outcomes: [...outcomes].reverse(),
    requestedRaceKeys: [...requests].reverse(),
  });
  assert.equal(first.status, "PASS");
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.baselines, second.baselines);
});
