# Research Engine

Boat Pon AI Development Bible が定義する Research Engine 機能の一覧と、現状の実装状況です。
「もう機能があるのに重複実装しない」ためのチェックリストとして使います。

凡例:

- ✅ 実装済み（該当CLIやモジュールがある）
- 🟡 部分実装（近い機能はあるが、型・状態管理・UIまでは揃っていない）
- ❌ 未実装（Phase 2以降で着手）

| 機能 | 状態 | 現状の実体 |
|---|---|---|
| ROI Explorer | 🟡 | `pnpm explore:roi` が `RuleEvaluationResult` 型で期間集計を出力（Phase 2最小実装）。条件別の深掘りは従来通り `report:quality` / `report:venue-monthly` / `analyze:roi-*` 系。条件フィルタの統合は Phase 2 残タスク |
| Pattern Discovery | 🟡 | `analyze:roi-decision-lab` / `analyze:roi-monthly-regime` / `analyze:roi-miss-patterns` などで手動探索している。自動探索エンジンではない |
| Feature Importance | ❌ | `report:feature-breakdown` は個別レースの特徴量寄与を出すのみ。ランキング・相互作用・相関の可視化は未実装 |
| Opportunity Score | ❌ | `report:daily` が近い情報を出すが★評価のスコアリングはない |
| Risk Score | 🟡 | `src/domain/raceEnvironment.ts` の `environmentRiskLevel` が部分的なリスク判定を持つ。Volatility/Drawdown込みの統合スコアはない |
| Confidence Score | 🟡 | `estimatedHitRate` / `sampleSize` はあるが、信頼度を1つの数値にまとめたものはない。Phase 1 の `EvaluationMetadata.confidence` で型を用意 |
| Drift Detection | ✅ | `src/domain/rollingDrift.ts`（月別ROI悪化検知、`report:calibration`）に加え、`src/domain/researchDrift.ts` + `pnpm detect:drift`（Phase 4最小実装: `RuleEvaluationResult`のbaseline/recent 2期間比較、read-only CLI）。Phase 4.1で表示契約（`src/view-models/driftViewModel.ts`、`src/presentation/driftPresentationModel.ts`）と`--presentation-json`、`--rule-id`による`research-rules.json`の**読み取り専用**連携を追加。複数ルール一括判定・通知連携は未着手 |
| Regime Detection | 🟡 | `src/domain/raceRegime.ts` はあるが、市場全体のレジーム分類・切り替えロジックは限定的 |
| Replay Engine | 🟡 | `scripts/walk-forward-history.ts`、`src/domain/backtest.ts` が近い。当時取得可能情報だけに絞った厳密なReplayは未整備 |
| What-if Simulator | ❌ | 未実装 |
| Hit Analysis | ✅ | `report:missed-hits`（逆）、decision_historyの的中行分析は各種reportで可能 |
| Miss Analysis | ✅ | `report:buy-misses`, `report:missed-hits` |
| Correlation Matrix | ❌ | 未実装 |
| Rule Comparison | 🟡 | `report:model-version-simple` がモデルバージョン比較を提供。ルール同士の一般比較は未整備 |
| Rule Merge / Split | ❌ | 未実装。`docs/rule-candidates.md` での手動判断のみ |
| Rule Timeline | 🟡 | `docs/rule-candidates.md` に週次で追記される候補ログがタイムライン相当。型としては未実装 |
| Rule Promotion / Retirement | 🟡 | `pnpm manage:research-rules`（Phase 3最小実装）でCandidate〜Productionの型付き状態遷移・Production直行禁止を強制できるようになった。ただし`docs/rule-candidates.md`の`candidate/watch/reject/adopted/reverted`運用とはまだ統合されていない（並行運用中） |
| AI Research Assistant | 🟡 | `scripts/run-review-suite.ts` が複数reportをまとめて実行。提案の自動生成・日次配信はまだ |
| Daily Research Report | 🟡 | `src/domain/dailyResearchReport.ts` + `pnpm daily:research-report`（Phase 5最小実装: ROI Explorerとdetect:driftの結果を1つの研究レポートに要約、`--json`/`--presentation-json`、read-only CLI）。**買い推奨・Production昇格の判断ではない**。複数ルール一括レポート・新仮説/Opportunity/`docs/rule-candidates.md`との統合は未着手 |

## 既存の重要な分析コマンド（重複防止用）

```sh
pnpm report:quality
pnpm report:venue-monthly
pnpm report:calibration
pnpm report:clv
pnpm report:paper-forward-candidates
pnpm report:paper-forward-monitor
pnpm analyze:wind24-exh1-switch
pnpm analyze:roi-bad-conditions
pnpm analyze:odds-payout-gap
pnpm analyze:payout-rebase
pnpm analyze:ticket-selector-strategies
pnpm analyze:roi-skip-filters
```

全コマンドの索引は `docs/cli-index.md` を参照してください。

## 新しい分析スクリプトを書く前に

1. 上の表と `docs/cli-index.md` を確認し、似た機能がないか探す
2. あれば拡張、なければ新規スクリプトを追加
3. 追加したら本ファイルの表と `docs/cli-index.md` を両方更新する
4. read-onlyであることを確認する（DB書き込みが必要な場合は別途ユーザー確認）

## 現在の評価基準（2025-06以降統一、`CLAUDE.md` と同一）

- 主評価: `race_payouts.payout_yen` 実払戻ベース
- 補助参考: `current_odds`（締切前暫定値、約14.94ptの楽観バイアスあり）
- gap >= 10pt の条件は `current_odds` 判断を信頼しない
