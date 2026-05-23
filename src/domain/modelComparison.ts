import { runWalkForwardBacktest, summarizeWalkForward, type WalkForwardSummary } from "./walkForward";
import type { ModelCandidateInput } from "./model";
import type { BudgetRule, RaceResult } from "./types";

export type ModelVariant = {
  id: string;
  label: string;
  targetEv: number;
  minSampleSize: number;
  alpha: number;
};

export type ModelComparisonRow = {
  variant: ModelVariant;
  summary: WalkForwardSummary;
  score: number;
  caution: string | null;
};

export function defaultModelVariants(settings: BudgetRule): ModelVariant[] {
  return [
    { id: "current", label: "現行", targetEv: settings.targetEv, minSampleSize: settings.minSampleSize, alpha: 1 },
    { id: "strict-ev", label: "EV厳しめ", targetEv: Math.max(settings.targetEv, 1.35), minSampleSize: settings.minSampleSize, alpha: 1 },
    { id: "more-sample", label: "サンプル厚め", targetEv: settings.targetEv, minSampleSize: Math.max(settings.minSampleSize, 1200), alpha: 1 },
    { id: "smooth", label: "平滑化強め", targetEv: settings.targetEv, minSampleSize: settings.minSampleSize, alpha: 10 },
  ];
}

export function compareModelVariants(input: {
  results: RaceResult[];
  programs: ModelCandidateInput[];
  settings: BudgetRule;
  oddsByRaceId?: Map<string, number>;
  variants?: ModelVariant[];
}): ModelComparisonRow[] {
  const variants = input.variants ?? defaultModelVariants(input.settings);
  return variants.map((variant) => {
    const settings = {
      ...input.settings,
      targetEv: variant.targetEv,
      minSampleSize: variant.minSampleSize,
    };
    const rows = runWalkForwardBacktest({
      results: input.results,
      programs: input.programs,
      settings,
      oddsByRaceId: input.oddsByRaceId,
      minTrainRaceCount: variant.minSampleSize,
      alpha: variant.alpha,
    });
    const summary = summarizeWalkForward(rows, settings.stakePerBetYen);
    return {
      variant,
      summary,
      score: scoreSummary(summary),
      caution: cautionFor(summary),
    };
  }).sort((a, b) => b.score - a.score);
}

function scoreSummary(summary: WalkForwardSummary) {
  const volumePenalty = summary.buy < 10 ? (10 - summary.buy) * 0.08 : 0;
  return summary.modelRoi + summary.hitRate * 0.3 - volumePenalty;
}

function cautionFor(summary: WalkForwardSummary) {
  if (summary.buy === 0) return "BUYなし";
  if (summary.buy < 10) return "BUY数が少なく過学習注意";
  if (summary.modelRoi < 1) return "回収率が100%未満";
  return null;
}
