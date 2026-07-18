export type T5MarketCoverageInput = {
  programs: number;
  fullMarketRaces: number;
  settledFullMarketRaces: number;
};

export function evaluateT5MarketCoverage(input: T5MarketCoverageInput) {
  const coverage = input.programs > 0 ? input.fullMarketRaces / input.programs : 0;
  const reasons: string[] = [];
  if (input.programs === 0) reasons.push("対象番組が0件");
  if (coverage < 0.80) reasons.push(`T-5全120通りcoverageが${(coverage * 100).toFixed(1)}%`);
  if (input.settledFullMarketRaces < 1_000) {
    reasons.push(`結果確定済みT-5完全市場が${input.settledFullMarketRaces}/1000`);
  }
  return { passed: reasons.length === 0, coverage, reasons };
}
