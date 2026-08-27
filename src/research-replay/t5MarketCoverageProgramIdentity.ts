export type T5MarketCoverageProgramRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
};

export function validateT5MarketCoverageProgramRows(
  rows: readonly T5MarketCoverageProgramRow[],
): T5MarketCoverageProgramRow[] {
  return rows.map((row) => {
    if (!isCanonicalCalendarDate(row.date)) {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_DATE_INVALID:${row.race_id}`);
    }
    if (!Number.isInteger(row.race_no) || row.race_no < 1 || row.race_no > 12) {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_RACE_NO_INVALID:${row.race_id}`);
    }
    if (typeof row.venue !== "string" || row.venue.trim() === "") {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_VENUE_INVALID:${row.race_id}`);
    }
    const expectedRaceId = `${row.date.replaceAll("-", "")}-${row.venue}-${String(row.race_no).padStart(2, "0")}`;
    if (row.race_id !== expectedRaceId) {
      throw new Error(`N2_T5_MARKET_COVERAGE_PROGRAM_RACE_ID_MISMATCH:${row.race_id}`);
    }
    return row;
  });
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
