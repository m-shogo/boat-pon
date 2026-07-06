import type { OpportunityPresentation, RiskLevel } from "../../presentation/presentationModel";
import type { PresentationRenderer } from "../../presentation/presentationRenderer";
import { RISK_COLOR } from "../../presentation/tokens/themeTokens";
import { CARD_SIZE } from "../../presentation/tokens/layoutTokens";

/**
 * Fable PoC（境界確認用）。
 *
 * 実際のFable(F#)コンパイラ/ツールチェインはまだ導入していない。このクラスは
 * TypeScriptで書いた「Fableが実装するとしたらこの形になる」というスタンドイン
 * であり、目的は演出そのものではなく、次の境界を確認すること:
 *
 * - PresentationRenderer<T> を実装するのに src/presentation/ 以外への依存が
 *   本当に不要か（domain/view-models/server/scriptsを一切importしない）
 * - OpportunityPresentation（すでに計算済みの値）をそのまま使うだけで
 *   ROI/risk/warning分類を再計算せずに描画できるか
 *
 * OpportunityPresentation以外の入力はthemeTokens/layoutTokensのみ。
 * renderRuleCard等はこのPoCの対象外（TODO、次に広げる候補は
 * docs/ai/06-FABLE-READINESS.mdを参照）。
 */

export type FableOpportunityView = {
  scoreLabel: string;
  score: number;
  riskLevel: RiskLevel;
  riskColor: string;
  summary: string;
  warningsCount: number;
  layout: { minWidth: number; maxWidth: number; minHeight: number };
};

export class FableOpportunityRenderer implements PresentationRenderer<unknown> {
  /**
   * OpportunityPresentationをそのまま表示用の形へ運ぶだけ。
   * scoreLabel/score/riskLevel/summaryは一切再計算しない。
   * warningsCountはOpportunityPresentationに無い値なので、呼び出し側
   * （RuleCardPresentation.warnings.length等）から別途渡す。
   */
  renderOpportunity(opportunity: OpportunityPresentation, warningsCount = 0): FableOpportunityView {
    return {
      scoreLabel: opportunity.scoreLabel,
      score: opportunity.score,
      riskLevel: opportunity.riskLevel,
      riskColor: RISK_COLOR[opportunity.riskLevel],
      summary: opportunity.summary,
      warningsCount,
      layout: { ...CARD_SIZE.opportunityCard },
    };
  }

  // TODO(Fable PoC): このPoCはOpportunityのみが対象。
  // 次に広げるならRule Lifecycleのステップ表示（docs/ai/06-FABLE-READINESS.md参照）。
  renderRuleCard(): unknown {
    throw new Error("FableOpportunityRenderer.renderRuleCard: not implemented (out of scope for this PoC)");
  }

  renderWarning(): unknown {
    throw new Error("FableOpportunityRenderer.renderWarning: not implemented (out of scope for this PoC)");
  }

  renderLifecycle(): unknown {
    throw new Error("FableOpportunityRenderer.renderLifecycle: not implemented (out of scope for this PoC)");
  }

  renderResearchSummary(): unknown {
    throw new Error("FableOpportunityRenderer.renderResearchSummary: not implemented (out of scope for this PoC)");
  }
}
