import type { LifecyclePresentation } from "../../presentation/presentationModel";

/**
 * docs/ai/presentation.sample.json の ruleCards[0].lifecycle をそのまま
 * 書き写した静的fixture。DB・CLI・ファイル読み込みには依存しない（静的値のみ）。
 */
export const sampleLifecycle: LifecyclePresentation = {
  steps: [
    { id: "candidate", label: "Candidate", isCompleted: false, isCurrent: true },
    { id: "backtest", label: "Backtest", isCompleted: false, isCurrent: false },
    { id: "forward", label: "Forward Test", isCompleted: false, isCurrent: false },
    { id: "review", label: "Review", isCompleted: false, isCurrent: false },
    { id: "approved", label: "Approved", isCompleted: false, isCurrent: false },
    { id: "production", label: "Production", isCompleted: false, isCurrent: false },
  ],
  currentStepId: "candidate",
};
