import { isCanonicalT5TrifectaResult } from "./t5MarketBaselineResult";

export type T5MarketCoverageSettlementRow = {
  returned: number;
  trifecta: string | null;
};

export function isCanonicalT5MarketCoverageSettlement(row: T5MarketCoverageSettlementRow): boolean {
  return row.returned === 0 && row.trifecta !== null && isCanonicalT5TrifectaResult(row.trifecta);
}
