import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HISTORICAL_RANKING_EPOCHS,
  parseHistoricalRankingEpochs,
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
