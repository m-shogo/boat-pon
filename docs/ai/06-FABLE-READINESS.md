# Fable Readiness

Fableは**まだ導入していない**。このドキュメントは、Fable導入を判断・実行する前に
確認すべきこと、Fableの担当範囲、Fableに任せてはいけないことを整理したメモです。
Phase 2.5（`docs/ai/04-ROADMAP.md`）で作った表示契約（`src/view-models/`）が
前提になる。

## なぜ今すぐFableを使わないか

- 現状のUI（`src/App.tsx` 他）はReact/TypeScriptで動いており、置き換える理由がまだ無い
- Research Engine（Phase 2〜）の出力形が固まっていない段階でFableを入れると、
  表示ロジックとデータ契約の両方を同時に作り直すことになり、切り分けが難しくなる
- Boat Ponの最優先順位は「データ品質 → Future Leak防止 → 統計的妥当性 → 再現性 → ROI向上」
  であり、UI/演出技術の選定はこれより下位（`docs/ai/00-VISION.md` の最優先順位を参照）
- 一度に巨大な変更をしない、という開発ルール（`docs/ai/02-DEVELOPMENT.md`）に反する

先に「Fableでもreactでも同じ形で消費できる表示契約」（`src/view-models/researchViewModel.ts`）
だけを固め、Fable導入自体はその後の独立した意思決定にする。

## Fableに任せるべきこと（将来）

UI/演出層に閉じた責務のみ。

- ROIカードのリッチな切り替え（`RuleCardViewModel` を受け取って描画するだけ）
- Opportunity Scoreの視覚演出（星の描き方、色、アニメーション）
- Rule Lifecycleのアニメーション（`RuleLifecycleStepViewModel[]` のステップ遷移演出）
- Daily Reportの見せ方（`ResearchSummaryViewModel` を一覧として描画するレイアウト）
- グラフやカードのトランジション

これらは全て「すでに計算済みのViewModelを受け取って、どう見せるか」だけを扱う。

## Fableに任せてはいけないこと

計算・判定・永続化・安全装置は引き続き `src/domain` / `server` に置く。UIフレームワークが
何であってもここは変わらない。

- ROI計算（`src/domain/researchEvaluation.ts`）
- Forward Test判定（`RuleEvaluationResult.isForwardTested` / Phase 3のForward Test実装）
- Rule Lifecycle状態遷移判定（`src/domain/researchRuleLifecycle.ts` の
  `canTransitionRuleStatus` / `validateProductionEligibility`）
- Future Leak防止（`validateEvaluationMetadata`）
- DB保存（`server/db.ts`）
- 通知判定（LINE/Web Push送信条件）
- Production昇格判定

理由: これらをUI層（Fable含む）に置くと「AIやUIの都合でルール採用を決める」ことに
つながりやすく、CLAUDE.mdの絶対原則（AI単独判断禁止・ブラックボックス禁止）に反する。
ViewModelは常に「すでにsrc/domainが決めた結果」を表示用に変換するだけの層であること。

## Fable導入前に必要な条件

- [x] Research Engineの分析結果を、UIフレームワークに依存しない型で表現できる
      （`src/view-models/researchViewModel.ts`）
- [x] `RuleEvaluationResult` → ViewModel の変換ロジックがUIから独立してテストできる
      （`src/view-models/researchViewModel.adapters.ts` + テスト）
- [x] CLIからViewModel形式のJSONを取得できる（`explore-roi.ts --view-json`）。
      これにより、Fable/React双方の実装者がバックエンドに依存せず表示だけを試作できる
- [ ] `src/view-models/` の型が複数のCLI/画面で実際に使われ、安定していることを確認する
      （現状は `explore-roi.ts` の単一カードのみ。Phase 5のDaily Reportで複数カードの
      実運用を経てから、初めて型が「固まった」と言える）
- [ ] Phase 3（Rule Lifecycle永続化）が完了し、`ResearchRule` が実際のstatus履歴を
      持つようになってから、`RuleLifecycleStepViewModel` の表現が正しいか再検証する
      （現状は履歴が無いため、deprecated/archivedの表示は簡略化している）
- [ ] Reactでの実装コストが本当に問題になっている（アニメーション・演出面で具体的な
      不満が出ている）ことを確認してから導入する。困っていないのに導入しない

## Reactで十分な範囲

現状、以下は全てReactで問題なく実装できる。Fableを検討する動機にならない。

- テーブル・カード・バッジの静的表示
- フォーム・設定画面
- 数値・警告の一覧表示
- 既存の `src/App.tsx` / `src/components/` の延長で作れる画面全般

## 将来Fableを使うならどの画面から試すべきか

上記の条件が満たされ、実際にFableを導入すると決めた場合、影響範囲が最小の画面から
試す。

1. **Opportunity Scoreの星表示だけの小さなコンポーネント** — `OpportunityScoreViewModel`
   1つを受け取って星と色を描画するだけの独立コンポーネント。既存UIへの影響が最小
2. Rule Lifecycleのステップ表示（`RuleLifecycleStepViewModel[]`）のタイムライン演出
3. うまくいけば、`RuleCardViewModel` 全体を使うROIカードのリッチ表示
4. 最後に `ResearchSummaryViewModel` を使うDaily Report画面全体

いきなり既存の `src/App.tsx` 全体をFableに置き換えることはしない。
