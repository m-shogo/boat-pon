import type {
  LifecyclePresentation,
  OpportunityPresentation,
  ResearchSummaryPresentation,
  RuleCardPresentation,
  WarningPresentation,
} from "./presentationModel";

/**
 * レンダラー非依存の抽象契約。実装はこのファイルに置かない
 * （React実装は許可されるがここでは書かない。Fable実装はまだ作らない）。
 *
 * `T` は各レンダラーが返す描画結果の型（Reactなら JSX.Element、
 * Fableなら ReactElement 相当、テスト用レンダラーなら文字列や
 * プレーンオブジェクトなど）。同じPresentationModelを渡せば、
 * どのレンダラー実装でも同じ入力から出力を作れることを保証する契約。
 */
export interface PresentationRenderer<T> {
  renderRuleCard(card: RuleCardPresentation): T;
  renderOpportunity(opportunity: OpportunityPresentation): T;
  renderWarning(warning: WarningPresentation): T;
  renderLifecycle(lifecycle: LifecyclePresentation): T;
  renderResearchSummary(summary: ResearchSummaryPresentation): T;
}
