export type MarketResidualInput = {
  selection: string;
  odds: number;
  modelProbability: number;
};

export type MarketResidualCandidate = MarketResidualInput & {
  marketProbability: number;
  normalizedModelProbability: number;
  residual: number;
};

export type BlendedMarketSelection = MarketResidualCandidate & {
  modelWeight: number;
  blendedProbability: number;
  blendedEv: number;
};

/**
 * 研究用。市場とモデルを同じ確率尺度へ正規化する。
 * partial oddsでの歪みを避けるため、呼び出し側で全120通りに近いことを確認する。
 */
export function normalizeMarketResidual(inputs: MarketResidualInput[]): MarketResidualCandidate[] {
  const valid = inputs.filter((row) =>
    Number.isFinite(row.odds) && row.odds > 0 && Number.isFinite(row.modelProbability) && row.modelProbability >= 0,
  );
  const marketTotal = valid.reduce((sum, row) => sum + 1 / row.odds, 0);
  const modelTotal = valid.reduce((sum, row) => sum + row.modelProbability, 0);
  if (marketTotal <= 0 || modelTotal <= 0) return [];
  return valid.map((row) => {
    const marketProbability = (1 / row.odds) / marketTotal;
    const normalizedModelProbability = row.modelProbability / modelTotal;
    return {
      ...row,
      marketProbability,
      normalizedModelProbability,
      residual: normalizedModelProbability - marketProbability,
    };
  });
}

export function selectBlendedMarketCandidate(
  candidates: MarketResidualCandidate[],
  modelWeight: number,
): BlendedMarketSelection | null {
  const weight = Math.min(1, Math.max(0, modelWeight));
  let selected: BlendedMarketSelection | null = null;
  for (const candidate of candidates) {
    const blendedProbability = candidate.marketProbability * (1 - weight) + candidate.normalizedModelProbability * weight;
    const row = { ...candidate, modelWeight: weight, blendedProbability, blendedEv: blendedProbability * candidate.odds };
    if (
      selected == null ||
      row.blendedEv > selected.blendedEv ||
      (row.blendedEv === selected.blendedEv && row.selection < selected.selection)
    ) selected = row;
  }
  return selected;
}
