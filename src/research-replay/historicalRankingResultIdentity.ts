import { validateT5MarketBaselineResultIdentityRows } from "./t5MarketBaselineResultIdentity";

export type HistoricalRankingResultIdentityRow = {
  race_id: string;
  result_date: string;
  result_venue: string;
  result_race_no: number;
};

export function validateHistoricalRankingResultIdentityRows<T extends HistoricalRankingResultIdentityRow>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => {
    validateT5MarketBaselineResultIdentityRows([{
      race_id: row.race_id,
      date: row.result_date,
      venue: row.result_venue,
      race_no: row.result_race_no,
    }]);
    return row;
  });
}
