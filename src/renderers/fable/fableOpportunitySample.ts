import type { OpportunityPresentation } from "../../presentation/presentationModel";

/**
 * docs/ai/presentation.sample.json の ruleCards[0].opportunity と
 * ruleCards[0].warnings.length をそのまま書き写した静的fixture。
 * DB・CLI・ファイル読み込みには依存しない（静的値のみ）。
 */
export const sampleOpportunity: OpportunityPresentation = {
  score: 2,
  scoreLabel: "★★☆☆☆",
  riskLevel: "high",
  summary: "explore-roi: 3 settled BUY (2 hits) in 2026-01-01..2026-06-01; roi basis: mixed (2/3 payo…",
};

export const sampleWarningsCount = 4;
