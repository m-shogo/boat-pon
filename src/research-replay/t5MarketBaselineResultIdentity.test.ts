import assert from "node:assert/strict";
import test from "node:test";
import { validateT5MarketBaselineResultIdentityRows } from "./t5MarketBaselineResultIdentity";

test("T-5 market baseline accepts producer-consistent result identity", () => {
  const row = {
    race_id: "20260827-桐生-01",
    date: "2026-08-27",
    venue: "桐生",
    race_no: 1,
    trifecta: "1-2-3",
    payout_yen: 1230,
    returned: 0,
  };
  assert.deepEqual(validateT5MarketBaselineResultIdentityRows([row]), [row]);
});

test("T-5 market baseline rejects result date, venue, or race-number lineage drift", () => {
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260827-桐生-01", date: "2026-08-28", venue: "桐生", race_no: 1 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260827-桐生-01", date: "2026-08-27", venue: "戸田", race_no: 1 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260827-桐生-01", date: "2026-08-27", venue: "桐生", race_no: 2 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH/u,
  );
});

test("T-5 market baseline rejects producer-impossible result identity components", () => {
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260230-桐生-01", date: "2026-02-30", venue: "桐生", race_no: 1 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_DATE_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260827-01-01", date: "2026-08-27", venue: "01", race_no: 1 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_VENUE_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260827- 桐生 -01", date: "2026-08-27", venue: " 桐生 ", race_no: 1 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_VENUE_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([
      { race_id: "20260827-桐生-13", date: "2026-08-27", venue: "桐生", race_no: 13 },
    ]),
    /N2_T5_MARKET_BASELINE_RESULT_RACE_NO_INVALID/u,
  );
});

test("T-5 market baseline rejects producer-impossible persisted settlement values", () => {
  const base = {
    race_id: "20260827-桐生-01",
    date: "2026-08-27",
    venue: "桐生",
    race_no: 1,
    trifecta: "1-2-3",
  };

  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([{ ...base, payout_yen: 1230.5, returned: 0 }]),
    /N2_T5_MARKET_BASELINE_RESULT_PAYOUT_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([{ ...base, payout_yen: -100, returned: 0 }]),
    /N2_T5_MARKET_BASELINE_RESULT_PAYOUT_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketBaselineResultIdentityRows([{ ...base, payout_yen: 1230, returned: 2 }]),
    /N2_T5_MARKET_BASELINE_RESULT_RETURNED_INVALID/u,
  );
  assert.deepEqual(
    validateT5MarketBaselineResultIdentityRows([{ ...base, payout_yen: null, returned: 0 }]),
    [{ ...base, payout_yen: null, returned: 0 }],
  );
});
