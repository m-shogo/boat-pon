# Architecture

目標アーキテクチャと、現在のコードがどこにマッピングされるかをまとめます。
実装済みの詳細は `docs/architecture.md` の方が正確なので、変更時はそちらも見てください。

## 責務分離（目標形）

```text
Data
  ↓
Feature Engineering
  ↓
Research Engine
  ↓
Statistics
  ↓
Validation
  ↓
Rule Engine
  ↓
Notification
  ↓
UI
```

原則:

- UIからBusiness Logicを呼ばない
- Business LogicはUIを知らない

## 現在のコードとのマッピング

| レイヤー | 現状の置き場所 | 備考 |
|---|---|---|
| Data | `scripts/fetch-*.ts`, `scripts/backfill-*.ts`, `data/` | 公式結果・番組・オッズ・展示・選手成績を取得しSQLiteへ保存 |
| Feature Engineering | `src/domain/programFeatures.ts`, `src/domain/raceEnvironment.ts`, `src/domain/programStats.ts` | 番組・展示・天候から特徴量を作る |
| Research Engine | 主に `scripts/report-*.ts`, `scripts/analyze-*.ts` | ROI Explorer / Pattern Discovery 相当の分析CLI群。専用の型・状態管理はまだない（Phase 1で着手） |
| Statistics | `src/domain/backtest.ts`, `src/domain/walkForward.ts`, `src/domain/rollingDrift.ts` | ROI集計・walk-forward・drift検知の計算ロジック |
| Validation | `scripts/validate-data.ts`, `scripts/decision-audit-doctor.ts`, `src/domain/programFeatureSafety.ts` | データ品質・audit設定・feature安全性のチェック |
| Rule Engine | `src/domain/decision.ts`, `src/domain/model.ts`, `server/db.ts` の `app_settings` | BUY/WATCH/SKIP判定。ライフサイクル管理は未実装（Phase 3で着手） |
| Notification | `src/domain/lineMessaging.ts`, `server/` のLINE/Web Push連携 | BUY候補の通知 |
| UI | `src/App.tsx`, `src/components/` | レビュー・監視画面 |

## ディレクトリ構造（実体）

```text
boat-pon
├─ server/          API・DBアクセス・通知・判定履歴保存
├─ src/             UI / domain logic / client側コード
│  └─ domain/        純粋関数中心のドメインロジック（*.ts + *.test.ts が対）
├─ scripts/         取得・検証・レポート・運用CLI（176+ファイル）
├─ docs/            運用手順・レビュー記録・設計メモ
│  └─ ai/            このディレクトリ。AI向けエントリポイント
├─ data/            SQLite DBなどのローカルデータ
├─ backups/         DBバックアップ
└─ design/          サンプル/参照デザイン。実装本体として扱わない
```

## 現状の弱点（`docs/architecture.md` より抜粋、Phase 3以降で対応）

1. `scripts/` が肥大化している（fetch/backfill/report/operation/migration が混在）
2. `server/db.ts` が責務過多（schema/query/decision_history/notification が集中）
3. Research Engine 相当の分析ロジックが CLI スクリプトとして散在しており、共通の型・ライフサイクル状態を持たない
4. UI が review CLI に追いついていない（forward test結果・drift・opportunityの画面がない）

Phase 1 ではこれらのリファクタリングは行わず、まず「研究対象の仮説（ResearchRule）を型として表現する」ことだけに着手します。大規模な移動・分割は行いません。
