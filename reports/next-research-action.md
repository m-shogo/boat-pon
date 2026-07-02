# 次のリサーチアクション計画

生成日時: 2026-06-30T23:06:51.497Z
governor 生成日時: 2026-06-29T22:06:34.827Z

> **⚠️ この計画は提案のみです。自動実行しません。write が必要な場合は人間確認後に実施してください。**
> **BUY は検証候補。ROI は検証指標。購入指示・採用判断ではない。app_settings 変更禁止。**

---

## 1行結論

> **次は「switch検証は全て完了 (H004/H006 とも switch reject)。condB timeseries overlap 蓄積待ち / H011 1-4系 forward monitor 継続」（write系は人間確認後）。switch検証: H004 6R=reject / H006 venue=reject / H001 condBはfuture-only timeseries overlap蓄積待ち（historical 174.4%だがtop2=92.2%）。skip: H003 6R / H005 venueともwatch（top2除外<100%・in-sampleバイアスありforward確認要）。本採用可能な edge はなし。次の大型候補は全券種ROIシミュレーター。**

## 次アクション: switch検証は全て完了 (H004/H006 とも switch reject)。condB timeseries overlap 蓄積待ち / H011 1-4系 forward monitor 継続

**根拠:** governor の自動判断に基づく次アクション

### 前提条件

- (なし)

### 実行ステップ

1. pnpm report:h011-forward-monitor (H011固定監視) / pnpm report:paper-forward-monitor

### 品質チェックリスト

- (なし)

### write 許可

| 項目 | 内容 |
|---|---|
| write 許可 | ❌ 今回は write なし |
| write 対象 | なし |
| 既存テーブルへの書き込み | **禁止** |

## 今やってはいけないこと

- ❌ app_settings 変更
- ❌ 本番 decision ロジック変更
- ❌ 1-3-5 / 1-3-6 新規買い目追加
- ❌ 選手相性の深掘り (condB/skip 完了前)
- ❌ allForward 一括 backfill (--priority allForward --write)
- ❌ 複数仮説の同時採用
- ❌ historical closing odds を live/T-5 forward として扱うこと
- ❌ top2除外ROI < 100% の候補を採用すること (condB top2=92.2%)
- ❌ future-only timeseries 未確認の候補を本採用すること
- ❌ skip6R / skipVenue の write (今回は確認ステップを先に)

## データ準備状況

| 項目 | 状態 |
|---|---|
| condB historical closing odds | 167/167 (100%) ✅ |
| skip6R historical closing odds | 215/215 (100%) ✅ |
| skipVenue historical closing odds | 159/159 (100%) ✅ |
| future-only timeseries condB overlap | 0 ❌ (<30) |

## 仮説状態サマリ

| ID | 名前 | 状態 | 採用可否 |
|---|---|---|:---:|
| H001 | condB 1-3-2 switch | testing-historical | ❌ |
| H002 | condB skip | tested-historical | ❌ |
| H003 | 6R skip | monitor | ❌ |
| H011 | 1-4系 市場過小評価 (2連単1-4) | closed-rejected | ❌ |
| H004 | 6R switch (代替買い目) | tested-historical | ❌ |
| H005 | 浜名湖+住之江 skip | monitor | ❌ |
| H006 | 浜名湖+住之江 switch (代替買い目) | tested-historical | ❌ |
| H007 | condB 1-3-4 switch | secondary | ❌ |
| H008 | 1-3-5 / 1-3-6 switch | backlog | ❌ |
| H009 | 選手タイプ × 会場構造 | backlog | ❌ |
| H010 | 会場別着順構造 | backlog | ❌ |

---
*生成: plan-next-research-action.ts*