import { validateT5MarketBaselineResultIdentityRows } from "./t5MarketBaselineResultIdentity";

export type HistoricalRankingPayoutIdentityRow = {
  race_id: string;
  payout_source: string;
  payout_date: string | null;
  payout_venue: string | null;
  payout_race_no: number | null;
};

export function validateHistoricalRankingPayoutIdentityRows<T extends HistoricalRankingPayoutIdentityRow>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => {
    if (row.payout_source !== "race_payouts") return row;
    if (row.payout_date === null || row.payout_venue === null || row.payout_race_no === null) {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_IDENTITY_MISSING:${row.race_id}`);
    }
    validateT5MarketBaselineResultIdentityRows([{
      race_id: row.race_id,
      date: row.payout_date,
      venue: row.payout_venue,
      race_no: row.payout_race_no,
    }]);
    return row;
  });
}
