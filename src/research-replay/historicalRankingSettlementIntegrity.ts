import { parseSettlementSelection } from "./settlement";

export type HistoricalRankingSettlementRow = {
  race_id: string;
  trifecta: string;
  payout_yen: number;
  payout_source: string;
  payout_returned: number;
};

export function validateHistoricalRankingSettlementRows<T extends HistoricalRankingSettlementRow>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => {
    const selection = parseSettlementSelection("trifecta", row.trifecta);
    if (!selection.valid || selection.canonical !== row.trifecta) {
      throw new Error(`HISTORICAL_RANKING_SELECTION_INVALID:${row.race_id}`);
    }
    if (row.payout_source !== "race_payouts" && row.payout_source !== "race_results") {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_SOURCE_INVALID:${row.race_id}`);
    }
    if (!Number.isSafeInteger(row.payout_yen) || row.payout_yen <= 0) {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_INVALID:${row.race_id}`);
    }
    if (row.payout_returned !== 0) {
      throw new Error(`HISTORICAL_RANKING_PAYOUT_RETURNED_INVALID:${row.race_id}`);
    }
    return row;
  });
}
