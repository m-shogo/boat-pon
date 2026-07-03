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

- [x] sample size / hit rate / ROI / confidence を1つの結果オブジェクトにまとめる — `src/domain/researchEvaluation.ts` の `buildRuleEvaluationResult`（`oddsPayoutYen` を再利用、確定BUY行のみで集計、window外行は除外）
- [x] JSON出力 — `pnpm explore:roi -- --json` で `RuleEvaluationResult` をそのまま出力
- [x] CLI実行 — `scripts/explore-roi.ts`（`pnpm explore:roi`）。`--from/--to/--rule-id/--json`。DB・テーブル欠損時は空評価+warningsで正常終了
- [x] Future Leak実行時チェック — `validateEvaluationMetadata`（start<=end、end<=evaluationRunAt、sampleSize>=0、欠損はwarnings）。Phase 1 の未決定事項を解消
- [ ] 条件別ROI集計 — 会場/月/オッズ帯などの条件フィルタは未実装。現状は期間フィルタのみ

### Phase 2 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/domain/researchEvaluation.ts` | `validateEvaluationMetadata`, `estimateConfidence`, `computeMaxDrawdown`, `buildRuleEvaluationResult`, `ROI_BASIS_WARNING` |
| `src/domain/researchEvaluation.test.ts` | metadata安全装置 + 出力形状のテスト（7件） |
| `scripts/explore-roi.ts` | 最小ROI Explorer CLI（read-only） |

### Phase 2 残タスク・未決定事項（TODO）

- 条件フィルタ（`--venue` / `--month` / `--decision` / オッズ帯など）の追加。既存 `analyze:roi-*` と重複しない範囲で段階的に
- ROIは `current_odds` ベース（約+14.94ptの楽観バイアス）。`payout_yen` 実払戻ベースへの切替オプションが必要（出力には `ROI_BASIS_WARNING` を常時付与済み）
- `estimateConfidence` は n/(n+50) の暫定縮小（n=200で0.8）。Bayesian Estimate導入時に置き換える
- `maxDrawdown` は累積BUY損益のピーク→谷を総投入額で割った暫定定義。定義の妥当性を採用判断前にレビューする
- `explore-roi.ts` のCLI経路自体の自動テストはない（アダプタ関数のテストで代替）。DBフィクスチャを使ったCLIテストはPhase 3以降で検討

## Phase 3: Rule Lifecycle — `not started`

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
