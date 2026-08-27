import { parseCanonicalRaceKey } from "./identity";

export type T5MarketCoverageProgramRow = {
  race_id: string;
  date: string;
  race_no: number;
};

export function validateT5MarketCoverageProgramRows(
  rows: readonly T5MarketCoverageProgramRow[],
): T5MarketCoverageProgramRow[] {
  return rows.map((row) => {
    let identity;
    try {
      identity = parseCanonicalRaceKey(row.race_id);
    } catch {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_RACE_ID_INVALID:${row.race_id}`);
    }
    if (identity.raceDateJst !== row.date) {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_DATE_MISMATCH:${row.race_id}`);
    }
    if (!Number.isInteger(row.race_no) || identity.raceNo !== row.race_no) {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_RACE_NO_MISMATCH:${row.race_id}`);
    }
    return row;
  });
}
