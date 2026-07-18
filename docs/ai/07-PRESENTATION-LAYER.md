# Presentation Layer

> **2026-07-18更新:** Real Fableの最小実装を追加した。Fable/F#はプレーンな表示契約を
> JavaScriptオブジェクトへ変換し、Reactが画面を構成する。FelizでReact全体を置換してはいない。
> 現在の構成は[12-REAL-FABLE-RESEARCH-LAB.md](12-REAL-FABLE-RESEARCH-LAB.md)を参照。
> 以下の未導入記述は導入前の設計履歴である。

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
| Lifecycle Timeline | `LifecyclePresentation` | `renderLifecycle`（境界確認PoC実装済み、`src/renderers/fable/fableLifecycleRenderer.ts`） |
| Research Summary / Daily Report | `ResearchSummaryPresentation` | `renderResearchSummary` |

Metric Gridだけ専用のrenderer関数を持たないのは、単独で表示されることが
今のところ無く、常に Rule Card の一部として描画されるため
（必要になれば `renderMetric` を追加すればよい。Interfaceの拡張は破壊的変更ではない）。

## Future Fable integration（次にやること）

### Fable PoC（境界確認、完了）

`OpportunityPresentation` の星表示だけを対象にした最小PoCを実施済み:

- `src/renderers/fable/fableOpportunityRenderer.ts` — `PresentationRenderer<T>` の
  `renderOpportunity` のみを実装した `FableOpportunityRenderer`。他の4メソッド
  （`renderRuleCard`/`renderWarning`/`renderLifecycle`/`renderResearchSummary`）は
  「このPoCの対象外」として明示的にエラーを投げる（TODO）
- `src/renderers/fable/fableOpportunitySample.ts` — `docs/ai/presentation.sample.json`
  由来の静的fixture
- `src/renderers/fable/fableOpportunityRenderer.test.ts` — 自ソースのimportを
  静的検査し、`src/presentation/` 以外（domain/view-models/server/scripts）への
  依存が無いことを機械的に確認するテストを含む

**重要**: これは実際のFable（F#/.NET）コンパイラを導入したものではない。
TypeScriptで書いた「Fableが実装するとしたらこの形になる」という境界確認用の
スタンドインであり、`PresentationRenderer<T>` を実装するのに
`src/presentation/` 以外への依存が本当に不要かを検証するのが目的。

このPoCで実証できたこと:

- `OpportunityPresentation` の `scoreLabel`/`score`/`riskLevel`/`summary` を
  一切再計算せず、そのまま表示側へ渡すだけで成立する
- `themeTokens`（`RISK_COLOR`）・`layoutTokens`（`CARD_SIZE`）は直接
  importして使える（Presentation Layerの一部なので依存として許可される）
- warnings countのように `OpportunityPresentation` に含まれない値は、
  型を拡張して混ぜ込むのではなく、呼び出し側から別引数として渡す形で
  境界を保てる

### Lifecycle PoC（境界確認、完了）

`LifecyclePresentation`（Lifecycle Timeline）を対象にした2つ目のPoCを実施済み:

- `src/renderers/fable/fableLifecycleRenderer.ts` — `renderLifecycle` のみを
  実装した `FableLifecycleRenderer`。他の4メソッド（`renderOpportunity`を含む）は
  「このPoCの対象外」としてエラーを投げる。`FableOpportunityRenderer`とは独立しており、
  互いに依存しない
- `src/renderers/fable/fableLifecycleSample.ts` — `docs/ai/presentation.sample.json`
  の`lifecycle`由来の静的fixture
- `src/renderers/fable/fableLifecycleRenderer.test.ts` — importの静的検査
  （`src/domain`/`researchRuleStore`/`view-models`/`server`/`scripts`への
  依存が無いことを確認）に加え、意図的に矛盾したfixture（`isCompleted`と
  `isCurrent`が同時にtrue、`currentStepId`がどのstepとも一致しない）を渡しても
  rendererが再判定せずそのまま通すことを確認

このPoCで実証できたこと:

- `LifecyclePresentation`の`steps`/`currentStepId`/`isCompleted`/`isCurrent`を
  一切再計算・再判定せず、そのまま表示側へ渡すだけで成立する
- Rule Lifecycleの永続化（Phase 3、`src/domain/researchRuleStore.ts`）を
  参照する必要が無い。RendererはRuleStatusの状態遷移可否判定に一切関与しない
- 複数のFable PoC（Opportunity・Lifecycle）を同時に導入しても、互いに干渉しない
  独立したレンダラーとして共存できる

### 本物のFableを導入するときにやること（次のセッション以降）

候補構成・影響範囲（npm/pnpm依存・ビルド影響・React共存方針）・rollback方法・
最小PoC手順・導入条件は `docs/ai/08-FABLE-IMPLEMENTATION-PLAN.md` に
まとめてある。**本物のFable導入は現時点でまだ許可されていない。**

1. .NET SDK / Fable コンパイラのツールチェイン導入（このリポジトリにはまだ無い）
2. `PresentationRenderer<Fable.ReactElement>`（型は実装時に決める）を実装する
   実際のF#/Feliz版 `FablePresentationRenderer` を新規作成する。
   `fableOpportunityRenderer.ts` が確認した依存境界・入力データの形をそのまま踏襲する
3. `src/presentation/tokens/themeTokens.ts` / `layoutTokens.ts` の値をFable側の
   スタイリング機構（Feliz.style等）に変換する薄いマッピング層を作る
4. `src/domain` / `src/view-models` / `src/presentation` のロジックには一切触らない
   （触る必要が出てきたら、それはPresentation Layerの設計に穴があるということ）
5. 次に広げるコンポーネントは Rule Lifecycle のステップ表示
   （`docs/ai/06-FABLE-READINESS.md` 参照）

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
- Renderer実装は `OpportunityPresentation` と `LifecyclePresentation` の2つのみ
  （`src/renderers/fable/fableOpportunityRenderer.ts` / `fableLifecycleRenderer.ts`、
  どちらもTypeScriptによる境界確認スタンドイン）。`renderRuleCard`/`renderWarning`/
  `renderResearchSummary` は React向け・Fable向けどちらも未実装
- 実際のFable（F#/.NET）ツールチェインはまだ導入していない。上記PoCはあくまで
  依存境界の確認であり、本物のコンパイラ導入は別タスク
- デザイントークン（`themeTokens.ts`/`layoutTokens.ts`）はプレースホルダー値。
  実際のブランド配色・実機での見た目確認はまだ行っていない
