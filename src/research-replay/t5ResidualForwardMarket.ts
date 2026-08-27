import { isCanonicalT5TrifectaResult } from "./t5MarketBaselineResult";

export function isCanonicalT5CompleteMarketSelections(values: Iterable<string>): boolean {
  const selections = new Set(values);
  return selections.size === 120 && [...selections].every(isCanonicalT5TrifectaResult);
}
