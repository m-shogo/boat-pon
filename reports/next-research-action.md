# 次のリサーチアクション計画

生成日時: 2026-06-11T02:06:07.176Z
governor 生成日時: 2026-06-11T02:05:52.968Z

> **⚠️ この計画は提案のみです。自動実行しません。write が必要な場合は人間確認後に実施してください。**
> **BUY は検証候補。ROI は検証指標。購入指示・採用判断ではない。app_settings 変更禁止。**

---

## 1行結論

> **次は「skipVenue historical alternative odds の小規模backfill準備 (87/159件未保存, H006用)」（write系は人間確認後）。condB switchはhistorical上有望（174.4%）だがtop2=92.2%/future-only未確認、6R switchは全候補reject（H004）のため本採用可能な edge はなし。**

## 次アクション: skipVenue historical alternative odds の小規模backfill準備 (87/159件未保存, H006用)

**根拠:** governor の自動判断に基づく次アクション

### 前提条件

- (なし)

### 実行ステップ

1. pnpm backfill:historical-alt-odds --limit 30 --priority skipVenue --write --sleep-ms 1000

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
| skipVenue historical closing odds | 72/159 (45%) ❌ |
| future-only timeseries condB overlap | 0 ❌ (<30) |

## 仮説状態サマリ

| ID | 名前 | 状態 | 採用可否 |
|---|---|---|:---:|
| H001 | condB 1-3-2 switch | testing-historical | ❌ |
| H002 | condB skip | tested-historical | ❌ |
| H003 | 6R skip | monitor | ❌ |
| H004 | 6R switch (代替買い目) | tested-historical | ❌ |
| H005 | 浜名湖+住之江 skip | monitor | ❌ |
| H006 | 浜名湖+住之江 switch (代替買い目) | waiting-data | ❌ |
| H007 | condB 1-3-4 switch | secondary | ❌ |
| H008 | 1-3-5 / 1-3-6 switch | backlog | ❌ |
| H009 | 選手タイプ × 会場構造 | backlog | ❌ |
| H010 | 会場別着順構造 | backlog | ❌ |

---
*生成: plan-next-research-action.ts*