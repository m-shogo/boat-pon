import assert from "node:assert/strict";
import test from "node:test";
import { validateT5MarketCoverageProgramRows } from "./t5MarketCoverageProgramIdentity";

test("T-5 market coverage program rows require producer-consistent race identity", () => {
  assert.deepEqual(
    validateT5MarketCoverageProgramRows([
      { race_id: "20260827-桐生-01", date: "2026-08-27", venue: "桐生", race_no: 1 },
      { race_id: "20280229-大村-12", date: "2028-02-29", venue: "大村", race_no: 12 },
    ]),
    [
      { race_id: "20260827-桐生-01", date: "2026-08-27", venue: "桐生", race_no: 1 },
      { race_id: "20280229-大村-12", date: "2028-02-29", venue: "大村", race_no: 12 },
    ],
  );
});

test("T-5 market coverage rejects impossible or mismatched program identity", () => {
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260230-桐生-01", date: "2026-02-30", venue: "桐生", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_DATE_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260826-桐生-01", date: "2026-08-27", venue: "桐生", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_RACE_ID_MISMATCH/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260827-桐生-02", date: "2026-08-27", venue: "桐生", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_RACE_ID_MISMATCH/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260827-桐生-13", date: "2026-08-27", venue: "桐生", race_no: 13 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_RACE_NO_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260827--01", date: "2026-08-27", venue: "", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_VENUE_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260827-架空場-01", date: "2026-08-27", venue: "架空場", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_VENUE_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "20260827-01-01", date: "2026-08-27", venue: "01", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_VENUE_INVALID/u,
  );
});
