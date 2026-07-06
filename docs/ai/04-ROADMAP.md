# Roadmap

Boat Pon AI Development Bible を実装可能な単位に分割したものです。
各Phaseは「設計 → 実装 → テスト → 検証 → Commit → Push → 停止」の1セットで進め、
1セッションでPhaseをまたいで大きく実装しない。

状態の凡例: `not started` / `in progress` / `done`

## Phase 1: Research Foundation — `done`（最小実装）

目的: ルール（仮説）のライフサイクルと評価結果を型として表現する土台を作る。DB・UI・自動化はまだ含めない。

- [x] Raw data保護方針 — 既存の `CLAUDE.md` 絶対禁止事項 + `docs/ai/00-VISION.md` に明文化済み（新規実装なし、既存方針の再確認）
- [x] Rule lifecycle model — `src/domain/researchRule.ts` の `RuleStatus`（candidate/backtest/forward/review/approved/production/deprecated/archived）
- [x] Hypothesis status model — `src/domain/researchRule.ts` の `ResearchRule`
- [x] Evaluation metadata — `src/domain/researchRule.ts` の `EvaluationMetadata`（dataWindowStart/End, evaluationRunAt, sampleSize）
- [x] Future Leak防止ルール — `EvaluationMetadata` で評価対象データ期間と評価実行時刻を必ず分離して記録する形にした（今後、生成コード側で `dataWindowEnd <= evaluationRunAt` を検証する処理はPhase 2以降で追加）
- [x] Forward Testの最小設計 — `ForwardTestResult`（`RuleEvaluationResult` に `isForwardTested: true` を強制した型）と `validateProductionEligibility` / `canTransitionRuleStatus`

### 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/researchRule.ts` | `RuleStatus`, `ResearchRule`, `EvaluationMetadata`, `RuleEvaluationResult`, `ForwardTestResult` |
| `src/domain/researchRuleLifecycle.ts` | `canTransitionRuleStatus(from, to)`, `validateProductionEligibility(rule, evaluation)`, `MIN_PRODUCTION_SAMPLE_SIZE`, `MIN_PRODUCTION_CONFIDENCE` |
| `src/domain/researchRuleLifecycle.test.ts` | ライフサイクルの安全装置のテスト |

### 未接続・未決定事項（TODO、Phase 2以降で判断）

- `ResearchRule` / `RuleEvaluationResult` はまだDBに保存されない（純粋な型とロジックのみ）。永続化は既存の `server/db.ts` に相乗りするか専用テーブルを作るか要判断
- `MIN_PRODUCTION_SAMPLE_SIZE = 200` は `CLAUDE.md` の「風速2〜4×1号艇展示1位」候補が forward n>=200 を格上げ条件にしていることに合わせた仮の値。他ルールにも一律適用してよいかは要レビュー
- `MIN_PRODUCTION_CONFIDENCE = 0.8` は暫定値。Bayesian Estimateの計算方法とセットで見直す
- ~~`dataWindowEnd <= evaluationRunAt` のFuture Leakチェックは型定義のみで、実行時バリデーション関数はまだ無い~~ → Phase 2 の `validateEvaluationMetadata` で解消済み

## Phase 2: ROI Explorer — `in progress`

目的: 条件別ROI集計を、Phase 1の型に載せて再利用可能にする。

- [x] sample size / hit rate / ROI / confidence を1つの結果オブジェクトにまとめる — `src/domain/researchEvaluation.ts` の `buildRuleEvaluationResult`（確定BUY行のみで集計、window外行は除外）
- [x] JSON出力 — `pnpm explore:roi -- --json` で `RuleEvaluationResult` をそのまま出力
- [x] CLI実行 — `scripts/explore-roi.ts`（`pnpm explore:roi`）。`--from/--to/--rule-id/--condition/--json`。DB・テーブル欠損時は空評価+warningsで正常終了
- [x] Future Leak実行時チェック — `validateEvaluationMetadata`（start<=end、end<=evaluationRunAt、sampleSize>=0、欠損はwarnings）。Phase 1 の未決定事項を解消
- [x] ROIを `payout_yen`（実払戻）優先に切替 — `realizedPayoutYen` が `payout_yen` をstakeへスケールして優先使用し、無い行のみ `current_odds` へfallback。fallback件数は `currentOddsFallbackWarning` で明示、`reasonSummary` に採用basis（payout_yen/current_odds fallback/mixed）を記録
- [x] 条件フィルタ（最小） — `--condition key=value` を追加。対応key: `venue` / `raceNo` / `decision`。単一条件のみ、AND/OR組み合わせは対象外。不正形式（`=`無し）はエラー、未対応keyはwarningで絞り込みスキップ
- [ ] 会場/月/オッズ帯など条件フィルタの拡充、複数条件のAND/OR対応

### Phase 2 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/researchEvaluation.ts` | `validateEvaluationMetadata`, `estimateConfidence`, `realizedPayoutYen`, `computeMaxDrawdown`, `currentOddsFallbackWarning`, `buildRuleEvaluationResult`, `parseCondition`, `applyCondition` |
| `src/domain/researchEvaluation.test.ts` | metadata安全装置・payout_yen優先/fallback・条件フィルタのテスト（12件） |
| `scripts/explore-roi.ts` | 最小ROI Explorer CLI（read-only、`--condition`対応） |

### Phase 2 正式検証状況

この開発環境（Claude Code実行環境）では `pnpm install` が完了しない — `registry.npmjs.org`
へのメタデータ取得が常時403、tarball取得も断続的に403（`x-deny-reason: host_not_allowed`）。
org policy denialであり、既に複数回・別パッケージでリトライして非一時的な遮断であることを
確認済み。**この環境ではこれ以上 `pnpm install` を再試行しない。** そのため以下は
**この環境では未実行**:

- `pnpm typecheck`
- `pnpm test`
- `pnpm explore:roi -- --json`

代替として、コミット済みソースをそのまま `node --experimental-strip-types --test`（scratchpad
上の一時コピーにimport拡張子`.ts`のみ付与、コミット物は変更なし）で実行し、Phase 1+2 合計
**17/17 テストpass** を確認。`explore-roi.ts` も同方式でフィクスチャSQLite DBに対して実行し、
payout_yen優先ROI・fallback・`--condition venue=...`・不正condition形式のエラー・未対応key
のwarningを検証済み。この代替手順は `pnpm run verify:strip-types` / `pnpm run verify:roi-smoke`
として自動化済み（`node_modules`不要、Node標準機能のみ）。詳細は `docs/ai/05-VERIFICATION.md`
のチェックリストを参照。

**Phase 3（Rule Lifecycle実装）に着手する前に、通常のpnpm環境に入り次第、上記3コマンドの
正式合格を確認すること。** 失敗した場合はこのセクションに結果を追記する。

### Phase 2 残タスク・未決定事項（TODO）

- 条件フィルタの拡充（月・オッズ帯など）、複数条件のAND/OR対応は依然未着手
- `estimateConfidence` は n/(n+50) の暫定縮小（n=200で0.8）。Bayesian Estimate導入時に置き換える
- `maxDrawdown` は累積BUY損益のピーク→谷を総投入額で割った暫定定義。定義の妥当性を採用判断前にレビューする
- `explore-roi.ts` のCLI経路自体の自動テストはない（アダプタ関数のテストで代替）。DBフィクスチャを使ったCLIテストはPhase 3以降で検討
- 通常pnpm環境での `pnpm typecheck` / `pnpm test` / `pnpm explore:roi -- --json` の正式実行が未確認（上記参照）

## Phase 2.5: Fable-ready View Contract — `done`（最小実装）

目的: Fableをまだ導入せず、将来React/FableどちらからでもResearch Engineの出力を
描画できる安定した表示契約を先に作る。詳細な判断根拠は `docs/ai/06-FABLE-READINESS.md`
を参照。

- [x] UIフレームワーク非依存の表示契約型 — `src/view-models/researchViewModel.ts`
      （`RuleCardViewModel`, `OpportunityScoreViewModel`, `WarningBadgeViewModel`,
      `RuleLifecycleStepViewModel`, `EvaluationMetricViewModel`, `ResearchSummaryViewModel`）
- [x] `RuleEvaluationResult`/`ResearchRule` → ViewModel 変換 — `src/view-models/researchViewModel.adapters.ts`
      （`buildRuleCardViewModel`, `buildOpportunityScoreViewModel`, `buildWarningBadges`,
      `buildLifecycleStepViewModel`, `buildResearchSummaryViewModel`）。ROI/Forward判定/
      Production判定はここでは計算し直さず、`src/domain` の結果をそのまま使う
- [x] `scripts/explore-roi.ts --view-json` — 既存 `--json`（`RuleEvaluationResult`そのまま）
      は無変更。`--view-json`は `ResearchSummaryViewModel` を出力する新オプション
- [x] Fable導入判断メモ — `docs/ai/06-FABLE-READINESS.md`

### Phase 2.5 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/view-models/researchViewModel.ts` | 表示契約の型定義のみ |
| `src/view-models/researchViewModel.adapters.ts` | 変換関数（`deriveRiskLevel`, `summarizeReason` 含む） |
| `src/view-models/researchViewModel.adapters.test.ts` | 安全装置のテスト |
| `scripts/explore-roi.ts` | `--view-json` 追加 |
| `docs/ai/06-FABLE-READINESS.md` | Fable導入前チェックリスト |

### Fable導入前の残タスク

`docs/ai/06-FABLE-READINESS.md` の「Fable導入前に必要な条件」参照。特に:

- `src/view-models/` の型が `explore-roi.ts` 単一カード以外の実運用（複数カード・
  Daily Report）を経ておらず、まだ「固まった」とは言えない
- Phase 3（Rule Lifecycle永続化）が終わるまで、`ResearchRule` はstatus履歴を持たず、
  `RuleLifecycleStepViewModel` のdeprecated/archived表現は簡略化したまま
- Fableは実装コストの具体的な不満が出てから検討する。現時点で導入を急ぐ理由はない

### Phase 3進行条件（更新）

Phase 3着手前提は変わらず: 通常pnpm環境で `pnpm typecheck` / `pnpm test` /
`pnpm explore:roi -- --json` が正式合格していること。加えて、Phase 2.5で追加した
`src/view-models/*.test.ts` も同じ `pnpm test` に含まれるため、これも合格対象に含まれる。

## Phase 2.6: Presentation Layer — `done`（最小実装、Fable導入直前の最終フェーズ）

目的: Fableをまだ導入せず、React/Fableどちらのレンダラーからも同じ形で消費できる
renderer非依存の最終表示契約（Presentation Layer）を作る。詳細は
`docs/ai/07-PRESENTATION-LAYER.md` を参照。

- [x] Presentation Models — `src/presentation/presentationModel.ts`
      （`RuleCardPresentation`, `OpportunityPresentation`, `WarningPresentation`,
      `LifecyclePresentation`, `MetricPresentation`, `ResearchSummaryPresentation`）
- [x] Presentation Builders — `src/presentation/presentationBuilder.ts`
      （`src/view-models` のViewModelを再整形するだけの純粋関数、計算ロジックなし）
- [x] Renderer Interface — `src/presentation/presentationRenderer.ts`
      （`PresentationRenderer<T>`。実装はReact/Fableどちらも未着手、インターフェースのみ）
- [x] Renderer Snapshot — `scripts/explore-roi.ts --presentation-json` +
      `docs/ai/presentation.sample.json`（実行して得た実データを保存した例）
- [x] Theme/Layout Tokens — `src/presentation/tokens/themeTokens.ts` /
      `layoutTokens.ts`（spacing/radius/typography/color/elevation/breakpoint/grid、
      CSSやアニメーションは含めない）
- [x] Presentation Validation — `src/presentation/presentationValidation.ts`
      （JSONシリアライズ可能性・DBエンティティ混入検知・決定性テストヘルパー）
- [x] Snapshot Tests — `src/presentation/presentation.test.ts`（9件）

### Phase 2.6 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/presentation/presentationModel.ts` | 表示契約の型定義 |
| `src/presentation/presentationBuilder.ts` | ViewModel→Presentationの再整形（純粋関数） |
| `src/presentation/presentationRenderer.ts` | `PresentationRenderer<T>` インターフェース |
| `src/presentation/tokens/themeTokens.ts` | spacing/radius/typography/color等のトークン |
| `src/presentation/tokens/layoutTokens.ts` | breakpoint/card size/grid/gapのトークン |
| `src/presentation/presentationValidation.ts` | シリアライズ可能性・DBエンティティ混入検知 |
| `src/presentation/presentation.test.ts` | スナップショットテスト |
| `scripts/explore-roi.ts` | `--presentation-json` 追加 |
| `docs/ai/presentation.sample.json` | 実行して得た出力例 |
| `docs/ai/07-PRESENTATION-LAYER.md` | アーキテクチャ・Component Contract・Fable統合手順 |

### レディネス状況

| 項目 | 状態 | 備考 |
|---|---|---|
| Presentation Ready | ✅ done | `src/presentation/` 一式、`--presentation-json` |
| Renderer Ready | 🟡 partial | インターフェースのみ。React/Fableどちらの実装もまだ無い |
| Fable Ready | 🟡 partial | データ契約は揃った。`docs/ai/06-FABLE-READINESS.md` の残条件（複数カード実運用、Phase 3完了、実装コスト面の必要性確認）は未達 |

### Phase 2.6後の残タスク

- Presentation Layerを実際に描画するレンダラー実装（React向けが先、Fableは
  次セッションのPoCで）がまだ無い
- 複数カード・Daily Report相当の実運用を経ていない（Phase 5待ち）
- デザイントークンはプレースホルダー値のまま。実配色・実機確認は未実施

## Phase 3: Rule Lifecycle — `in progress`

**着手前提: 満たした（2026-07-06）。** 通常pnpm環境で `pnpm typecheck` / `pnpm test`
（192/192）/ `pnpm explore:roi -- --json|--view-json|--presentation-json` の正式合格を
確認済み（`docs/ai/05-VERIFICATION.md` 参照）。Claude Code実行環境の403制約下で追加作業
する場合は `pnpm run verify:strip-types` / `pnpm run verify:roi-smoke` で代替検証し、
その旨を完了報告に明記する。

目的: Phase 1の型・状態遷移関数を実際の運用（`docs/rule-candidates.md` の手動運用）に接続する。

- [ ] Candidate / Backtest / Forward / Review / Approved / Production / Deprecated / Archive の永続化（テーブルまたはJSON/Markdownとの同期方式は要判断）
- [ ] 状態遷移制約の適用箇所（どのCLI/UIから呼ばれるか）
- [ ] Production直行禁止をコード上で強制する経路の実装
- [ ] `docs/rule-candidates.md` の `candidate/watch/reject/adopted/reverted` との対応関係を整理（用語を統一するか、マッピング表を作るか）

## Phase 4: Drift Detection — `not started`

目的: 既存の `rollingDrift.ts` を拡張し、複数期間比較と警告出力を統一する。

- [ ] 直近30/60/90日 vs 長期比較
- [ ] ROI悪化検知（閾値は既存 `rollingDrift.ts` の `alert` 判定を参考に拡張）
- [ ] 警告出力（通知連携は既存のLINE/Web Push経路に相乗りするか要判断）

## Phase 5: Daily Research Report — `not started`

目的: 新仮説・Forward結果・Drift・Opportunity・見送り推奨を1つの日次レポートにまとめる。

- [ ] 新仮説（Phase 2の出力から）
- [ ] Forward結果（Phase 1の `ForwardTestResult` から)
- [ ] Drift（Phase 4の出力から）
- [ ] 今日のOpportunity
- [ ] 見送り推奨

Phase 5 は Phase 2〜4 が揃うまで着手しない。

## 進行ルール

- 各Phaseの開始前に、このファイルの状態を `in progress` に更新する
- Phase内でも一度に全項目を実装しない。小さなコミットに分ける
- 次のセッションへの引き継ぎは、このファイルの `未接続・未決定事項` に残す
