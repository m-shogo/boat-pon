import type { LifecyclePresentation } from "../../presentation/presentationModel";
import type { PresentationRenderer } from "../../presentation/presentationRenderer";
import { TYPOGRAPHY } from "../../presentation/tokens/themeTokens";
import { GAP } from "../../presentation/tokens/layoutTokens";

/**
 * Fable PoC（境界確認用、Lifecycle Timeline版）。
 *
 * fableOpportunityRenderer.tsと同じ目的の別コンポーネント版: 実際のFable(F#)
 * コンパイラ/ツールチェインはまだ導入していない。TypeScriptで書いた
 * 「Fableが実装するとしたらこの形になる」というスタンドインで、次の境界を確認する。
 *
 * - PresentationRenderer<T> を実装するのに src/presentation/ 以外への依存が
 *   本当に不要か（domain/view-models/server/scripts/researchRuleStoreを一切importしない）
 * - LifecyclePresentation（すでにRuleStatus判定・isCompleted/isCurrent計算が
 *   済んだ値）をそのまま使うだけで、再判定せずに描画できるか
 *
 * LifecyclePresentation以外の入力はthemeTokens/layoutTokensのみ。
 * renderRuleCard等（renderOpportunityを含む）はこのPoCの対象外。
 */

export type FableLifecycleStepView = {
  id: string;
  label: string;
  isCompleted: boolean;
  isCurrent: boolean;
};

export type FableLifecycleView = {
  steps: FableLifecycleStepView[];
  currentStepId: string | null;
  stepGap: number;
  labelFontSize: number;
};

export class FableLifecycleRenderer implements PresentationRenderer<unknown> {
  /**
   * LifecyclePresentationをそのまま表示用の形へ運ぶだけ。
   * steps/currentStepId/isCompleted/isCurrentは一切再計算しない
   * （RuleStatusの判定・状態遷移の可否はsrc/domain/researchRuleLifecycle.ts /
   * researchRuleStore.tsの役割のまま）。
   */
  renderLifecycle(lifecycle: LifecyclePresentation): FableLifecycleView {
    return {
      steps: lifecycle.steps.map((step) => ({
        id: step.id,
        label: step.label,
        isCompleted: step.isCompleted,
        isCurrent: step.isCurrent,
      })),
      currentStepId: lifecycle.currentStepId,
      stepGap: GAP.badgeGap,
      labelFontSize: TYPOGRAPHY.size.sm,
    };
  }

  // TODO(Fable PoC): このPoCはLifecycleのみが対象。
  // 次に広げるならRuleCard全体、またはResearch Summary（docs/ai/06-FABLE-READINESS.md参照）。
  renderRuleCard(): unknown {
    throw new Error("FableLifecycleRenderer.renderRuleCard: not implemented (out of scope for this PoC)");
  }

  renderOpportunity(): unknown {
    throw new Error("FableLifecycleRenderer.renderOpportunity: not implemented (out of scope for this PoC)");
  }

  renderWarning(): unknown {
    throw new Error("FableLifecycleRenderer.renderWarning: not implemented (out of scope for this PoC)");
  }

  renderResearchSummary(): unknown {
    throw new Error("FableLifecycleRenderer.renderResearchSummary: not implemented (out of scope for this PoC)");
  }
}
