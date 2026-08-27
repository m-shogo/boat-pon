export type T5MarketBaselineResultIdentityRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
};

export function validateT5MarketBaselineResultIdentityRows<T extends T5MarketBaselineResultIdentityRow>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => {
    const expectedRaceId = `${row.date.replaceAll("-", "")}-${row.venue}-${String(row.race_no).padStart(2, "0")}`;
    if (row.race_id !== expectedRaceId) {
      throw new Error(`N2_T5_MARKET_BASELINE_RESULT_IDENTITY_MISMATCH:${row.race_id}`);
    }
    return row;
  });
}
