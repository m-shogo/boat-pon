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

function programRaw(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      className: "A1",
      nationalWinRate: 6.5,
      nationalTop2Rate: 48.2,
      localWinRate: 6.1,
      localTop2Rate: 45.3,
      motorTop2Rate: 37.4,
      boatTop2Rate: 34.2,
      ...(index === 0 ? overrides : {}),
    })),
  });
}

test("historical ranking accepts producer-consistent settlement evidence", () => {
  assert.deepEqual(validateHistoricalRankingSettlementRows([base]), [base]);
  assert.deepEqual(
    validateHistoricalRankingSettlementRows([{ ...base, payout_source: "race_results" }]),
    [{ ...base, payout_source: "race_results" }],
  );
  const withProgram = { ...base, raw_json: programRaw() };
  assert.deepEqual(validateHistoricalRankingSettlementRows([withProgram]), [withProgram]);
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

test("historical ranking rejects producer-impossible program feature values", () => {
  for (const [field, value] of [
    ["nationalWinRate", -0.1],
    ["nationalWinRate", 10.1],
    ["nationalTop2Rate", 100.1],
    ["localWinRate", 11],
    ["localTop2Rate", -1],
    ["motorTop2Rate", 101],
    ["boatTop2Rate", "34.2"],
  ] as const) {
    assert.throws(
      () => validateHistoricalRankingSettlementRows([{ ...base, raw_json: programRaw({ [field]: value }) }]),
      /HISTORICAL_RANKING_PROGRAM_RATE_INVALID/u,
    );
  }
  assert.throws(
    () => validateHistoricalRankingSettlementRows([{ ...base, raw_json: programRaw({ className: "C1" }) }]),
    /HISTORICAL_RANKING_PROGRAM_CLASS_INVALID/u,
  );
});

test("historical ranking preserves the existing malformed-program exclusion path", () => {
  for (const raw_json of ["not-json", JSON.stringify({})]) {
    const row = { ...base, raw_json };
    assert.deepEqual(validateHistoricalRankingSettlementRows([row]), [row]);
  }
});
