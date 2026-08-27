import assert from "node:assert/strict";
import test from "node:test";
import { validateHistoricalRankingResultIdentityRows } from "./historicalRankingResultIdentity";

const base = {
  race_id: "20260827-桐生-01",
  result_date: "2026-08-27",
  result_venue: "桐生",
  result_race_no: 1,
};

test("historical ranking accepts producer-consistent result identity", () => {
  assert.deepEqual(validateHistoricalRankingResultIdentityRows([base]), [base]);
});

test("historical ranking rejects result identity drift", () => {
  assert.throws(
    () => validateHistoricalRankingResultIdentityRows([{ ...base, result_date: "2026-08-28" }]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateHistoricalRankingResultIdentityRows([{ ...base, result_venue: "戸田" }]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateHistoricalRankingResultIdentityRows([{ ...base, result_race_no: 2 }]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
});
