import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HISTORICAL_RANKING_EPOCHS,
  parseHistoricalRankingEpochs,
  validateHistoricalRankingForwardCohorts,
} from "./historicalRankingForwardOptions";

test("historical ranking epochs default to the frozen research value", () => {
  assert.equal(parseHistoricalRankingEpochs(undefined), DEFAULT_HISTORICAL_RANKING_EPOCHS);
  assert.equal(DEFAULT_HISTORICAL_RANKING_EPOCHS, 12);
});

test("historical ranking epochs accept positive safe integers", () => {
  assert.equal(parseHistoricalRankingEpochs("1"), 1);
  assert.equal(parseHistoricalRankingEpochs("12"), 12);
  assert.equal(parseHistoricalRankingEpochs("9007199254740991"), Number.MAX_SAFE_INTEGER);
});

test("historical ranking epochs reject values that can skip, round, or never finish training", () => {
  for (const raw of ["", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
    assert.throws(
      () => parseHistoricalRankingEpochs(raw),
      (error: unknown) => error instanceof Error && error.message === "HISTORICAL_RANKING_EPOCHS_INVALID",
      raw,
    );
  }
});

test("historical ranking forward requires non-empty train, validation, and test cohorts", () => {
  assert.doesNotThrow(() => validateHistoricalRankingForwardCohorts({ train: 10, validation: 4, test: 2 }));
  for (const [name, counts] of [
    ["train", { train: 0, validation: 4, test: 2 }],
    ["validation", { train: 10, validation: 0, test: 2 }],
    ["test", { train: 10, validation: 4, test: 0 }],
  ] as const) {
    assert.throws(
      () => validateHistoricalRankingForwardCohorts(counts),
      (error: unknown) => error instanceof Error && error.message === `HISTORICAL_RANKING_COHORT_EMPTY:${name}`,
    );
  }
});
