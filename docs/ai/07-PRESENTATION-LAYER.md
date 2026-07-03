# Presentation Layer

Fable導入直前の最終フェーズで作った、レンダラー非依存のPresentation Layerについての
ドキュメントです。**Fableはまだ導入していません。** 次のセッションは
「既存のPresentation Layerを使って最初のFableレンダラーを実装する」ことから始まります。

## Architecture

```text
Raw Data
  ↓
Research Engine        (scripts/analyze-*.ts, scripts/report-*.ts)
  ↓
Statistics              (src/domain/backtest.ts, researchEvaluation.ts)
  ↓
Rule Engine             (src/domain/researchRule.ts, researchRuleLifecycle.ts)
  ↓
[ View Model ]          (src/view-models/researchViewModel*.ts) — Phase 2.5、計算層
  ↓
Presentation Layer      (src/presentation/) — 今回のフェーズ、renderer非依存の最終契約
  ↓
Renderer                (PresentationRenderer<T> インターフェース)
  ↓
React（現在）  /  Fable（将来）
```

`src/view-models/` と `src/presentation/` は役割が異なる。

- **`src/view-models/`**: `RuleEvaluationResult`/`ResearchRule` から実際に
  risk level・opportunity score・warning badge・lifecycle stepを**計算する**層
  （`researchViewModel.adapters.ts`）。ROIが高くてもsampleSize不足ならriskを上げる、
  といった判断ロジックはここにある。
- **`src/presentation/`**: 計算済みのViewModelを、renderer契約の形へ**並べ替えるだけ**の層
  （`presentationBuilder.ts`）。ここには判断ロジックを一切置かない。

計算とレンダラー契約を分けているのは、将来Fableを導入したときに
「表示の都合でROI/risk計算を書き換えたくなる」誘惑を構造的に防ぐため。

## Renderer independence

`src/presentation/presentationRenderer.ts` の `PresentationRenderer<T>` は、
実装を持たない抽象契約。

```ts
export interface PresentationRenderer<T> {
  renderRuleCard(card: RuleCardPresentation): T;
  renderOpportunity(opportunity: OpportunityPresentation): T;
  renderWarning(warning: WarningPresentation): T;
  renderLifecycle(lifecycle: LifecyclePresentation): T;
  renderResearchSummary(summary: ResearchSummaryPresentation): T;
}
```

`T` を戻り値のジェネリクスにしているのは、Reactなら `JSX.Element`、Fableなら
Fable自身の要素型、テスト用レンダラーならプレーンオブジェクトや文字列を返せるようにするため。
**この段階では実装を1つも書いていない。** 次にFableを導入するときに、この契約を実装する
`FablePresentationRenderer` を作ることが最初の作業になる。

## Presentation flow（実際のデータの流れ）

`scripts/explore-roi.ts --presentation-json` を例にすると:

```text
decision_history（SQLite）
  ↓ loadRows() / applyCondition()
DecisionHistoryRow[]
  ↓ buildRuleEvaluationResult()          (src/domain/researchEvaluation.ts)
RuleEvaluationResult
  ↓ buildRuleCardViewModel()             (src/view-models/researchViewModel.adapters.ts)
RuleCardViewModel                         ← risk/opportunity/warning/lifecycleを計算
  ↓ buildResearchSummaryViewModel()
ResearchSummaryViewModel
  ↓ buildResearchPresentation()          (src/presentation/presentationBuilder.ts)
ResearchSummaryPresentation               ← レンダラー契約へ並べ替えるだけ
  ↓ JSON.stringify()
presentation.json（例: docs/ai/presentation.sample.json）
```

## Component contract（Phase E）

| コンポーネント | Presentation型 | Rendererメソッド |
|---|---|---|
| Rule Card | `RuleCardPresentation` | `renderRuleCard` |
| Opportunity Card | `OpportunityPresentation` | `renderOpportunity` |
| Warning Badge | `WarningPresentation` | `renderWarning` |
| Metric Grid | `MetricPresentation[]`（`RuleCardPresentation.metrics`） | 専用メソッドなし。`renderRuleCard`内で描画する想定 |
| Lifecycle Timeline | `LifecyclePresentation` | `renderLifecycle` |
| Research Summary / Daily Report | `ResearchSummaryPresentation` | `renderResearchSummary` |

Metric Gridだけ専用のrenderer関数を持たないのは、単独で表示されることが
今のところ無く、常に Rule Card の一部として描画されるため
（必要になれば `renderMetric` を追加すればよい。Interfaceの拡張は破壊的変更ではない）。

## Future Fable integration（次にやること）

次のセッションの冒頭タスクは「既存のPresentation Layerを使って最初のFableレンダラーを
実装する」。`docs/ai/06-FABLE-READINESS.md` の「将来Fableを使うならどの画面から試すべきか」
の通り、影響範囲が最小の `OpportunityPresentation` 単体の星表示から始めるのを推奨する。

Fableレンダラーを実装するときにやること:

1. `PresentationRenderer<Fable.ReactElement>`（型は実装時に決める）を実装する
   `FablePresentationRenderer` を新規作成する
2. `src/presentation/tokens/themeTokens.ts` / `layoutTokens.ts` の値をFable側の
   スタイリング機構（Feliz.style等）に変換する薄いマッピング層を作る
3. `src/domain` / `src/view-models` / `src/presentation` のロジックには一切触らない
   （触る必要が出てきたら、それはPresentation Layerの設計に穴があるということ）

## Current React usage（現状）

現状のReact実装（`src/App.tsx`, `src/components/`）は、まだPresentation Layerを
経由していない。`scripts/explore-roi.ts` はCLIであり画面を持たないため、
`--presentation-json` の出力を実際に画面へ表示するReactコンポーネントはまだ無い。

これは意図的: 今回のフェーズは「Presentation Layerを作ること」までで、
「既存React画面をPresentation Layer経由に置き換えること」は含めていない
（既存UIの大改造禁止というルールのため）。既存画面のリファクタは、
Presentation Layerが複数のCLI/画面で実際に使われて安定してから、別フェーズで判断する。

## Why Presentation Layer exists

- **Renderer非依存**: React/Fableどちらもこの同じ型・同じJSONを消費できる。
  Fable導入時にビジネスロジックを一切変更しなくて済む
- **責務分離の強制**: Presentation Layerには判断ロジックを書けない設計にすることで、
  「UIの都合でROI/risk判定を変える」ことを構造的に防ぐ（CLAUDE.mdの
  AI単独判断禁止・ブラックボックス禁止の原則に沿う）
- **検証可能性**: `presentationValidation.ts` により、DBの生カラムが紛れ込んでいないか、
  シリアライズ可能か、決定的かを機械的にチェックできる
- **段階的な移行**: 既存Reactを壊さずに、Presentation Layerを新設できた
  （`src/view-models/` の `--view-json` はそのまま残っている）

## 制約・残タスク（Fable導入前）

`docs/ai/06-FABLE-READINESS.md` の「Fable導入前に必要な条件」を参照。加えて今回追加した
分:

- Presentation Layerは `explore-roi.ts --presentation-json` の単一カード出力でしか
  検証されていない。複数カードでの実運用（Phase 5 Daily Report）はまだ無い
- Renderer実装（React向け・Fable向けどちらも）はまだ1つも書いていない
  （インターフェースのみ）
- デザイントークン（`themeTokens.ts`/`layoutTokens.ts`）はプレースホルダー値。
  実際のブランド配色・実機での見た目確認はまだ行っていない
