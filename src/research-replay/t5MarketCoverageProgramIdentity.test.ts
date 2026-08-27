import assert from "node:assert/strict";
import test from "node:test";
import { validateT5MarketCoverageProgramRows } from "./t5MarketCoverageProgramIdentity";

test("T-5 market coverage program rows require canonical race identity lineage", () => {
  assert.deepEqual(
    validateT5MarketCoverageProgramRows([
      { race_id: "2026-08-27:01:R1", date: "2026-08-27", race_no: 1 },
      { race_id: "2028-02-29:24:R12", date: "2028-02-29", race_no: 12 },
    ]),
    [
      { race_id: "2026-08-27:01:R1", date: "2026-08-27", race_no: 1 },
      { race_id: "2028-02-29:24:R12", date: "2028-02-29", race_no: 12 },
    ],
  );
});

test("T-5 market coverage rejects impossible or mismatched program identity", () => {
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "2026-02-30:01:R1", date: "2026-02-28", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_RACE_ID_INVALID/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "2026-08-27:01:R1", date: "2026-08-26", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_DATE_MISMATCH/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "2026-08-27:01:R1", date: "2026-08-27", race_no: 2 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_RACE_NO_MISMATCH/u,
  );
  assert.throws(
    () => validateT5MarketCoverageProgramRows([
      { race_id: "2026-08-27:25:R1", date: "2026-08-27", race_no: 1 },
    ]),
    /N2_T5_MARKET_COVERAGE_PROGRAM_RACE_ID_INVALID/u,
  );
});
