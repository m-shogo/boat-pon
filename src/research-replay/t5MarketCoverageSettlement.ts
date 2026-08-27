import { isCanonicalT5TrifectaResult } from "./t5MarketBaselineResult";

export type T5MarketCoverageSettlementRow = {
  date: string;
  returned: number;
  trifecta: string | null;
};

export function isCanonicalT5MarketCoverageSettlement(
  row: T5MarketCoverageSettlementRow,
  expectedProgramDate: string,
): boolean {
  return row.date === expectedProgramDate
    && row.returned === 0
    && row.trifecta !== null
    && isCanonicalT5TrifectaResult(row.trifecta);
}
