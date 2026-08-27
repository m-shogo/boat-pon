import assert from "node:assert/strict";
import test from "node:test";
import { validateHistoricalRankingPayoutIdentityRows } from "./historicalRankingPayoutIdentity";

const base = {
  race_id: "20260827-桐生-01",
  payout_source: "race_payouts",
  payout_date: "2026-08-27",
  payout_venue: "桐生",
  payout_race_no: 1,
};

test("historical ranking accepts producer-consistent payout identity", () => {
  assert.deepEqual(validateHistoricalRankingPayoutIdentityRows([base]), [base]);
});

test("historical ranking rejects payout identity drift when race_payouts supplies ROI", () => {
  assert.throws(
    () => validateHistoricalRankingPayoutIdentityRows([{ ...base, payout_date: "2026-08-28" }]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateHistoricalRankingPayoutIdentityRows([{ ...base, payout_venue: "戸田" }]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateHistoricalRankingPayoutIdentityRows([{ ...base, payout_race_no: 2 }]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
});

test("historical ranking requires payout identity when race_payouts supplies ROI", () => {
  assert.throws(
    () => validateHistoricalRankingPayoutIdentityRows([{ ...base, payout_date: null }]),
    /HISTORICAL_RANKING_PAYOUT_IDENTITY_MISSING/u,
  );
  const fallback = { ...base, payout_source: "race_results", payout_date: null, payout_venue: null, payout_race_no: null };
  assert.deepEqual(validateHistoricalRankingPayoutIdentityRows([fallback]), [fallback]);
});
