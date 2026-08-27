import assert from "node:assert/strict";
import test from "node:test";
import { validateHistoricalRankingSettlementRows } from "./historicalRankingSettlementIntegrity";

const base = {
  race_id: "20260827-桐生-01",
  trifecta: "1-2-3",
  payout_yen: 1230,
  payout_source: "race_payouts",
  payout_returned: 0,
};

test("historical ranking accepts producer-consistent settlement evidence", () => {
  assert.deepEqual(validateHistoricalRankingSettlementRows([base]), [base]);
  assert.deepEqual(
    validateHistoricalRankingSettlementRows([{ ...base, payout_source: "race_results" }]),
    [{ ...base, payout_source: "race_results" }],
  );
});

test("historical ranking rejects producer-impossible result selection", () => {
  for (const trifecta of ["01-2-3", "1-1-2", "7-1-2", "1-2"]) {
    assert.throws(
      () => validateHistoricalRankingSettlementRows([{ ...base, trifecta }]),
      /HISTORICAL_RANKING_SELECTION_INVALID/u,
    );
  }
});

test("historical ranking rejects payout values that can distort ROI gates", () => {
  assert.throws(
    () => validateHistoricalRankingSettlementRows([{ ...base, payout_yen: -100 }]),
    /HISTORICAL_RANKING_PAYOUT_INVALID/u,
  );
  assert.throws(
    () => validateHistoricalRankingSettlementRows([{ ...base, payout_yen: 1230.5 }]),
    /HISTORICAL_RANKING_PAYOUT_INVALID/u,
  );
});

test("historical ranking rejects returned or unknown payout authority", () => {
  assert.throws(
    () => validateHistoricalRankingSettlementRows([{ ...base, payout_returned: 1 }]),
    /HISTORICAL_RANKING_PAYOUT_RETURNED_INVALID/u,
  );
  assert.throws(
    () => validateHistoricalRankingSettlementRows([{ ...base, payout_source: "forged" }]),
    /HISTORICAL_RANKING_PAYOUT_SOURCE_INVALID/u,
  );
});
