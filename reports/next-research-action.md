# 次のリサーチアクション計画

生成日時: 2026-06-11T01:46:26.345Z
governor 生成日時: 2026-06-11T01:46:11.677Z

> **⚠️ この計画は提案のみです。自動実行しません。write が必要な場合は人間確認後に実施してください。**
> **BUY は検証候補。ROI は検証指標。購入指示・採用判断ではない。app_settings 変更禁止。**

---

## 1行結論

> **次は skip6R historical alt odds の小規模backfill準備（人間確認後）。condB switchはhistorical上有望（174.4%）だがtop2=92.2%/future-only未確認のため本採用不可。**

## 次アクション: skip6R historical alternative odds 小規模 backfill (残 72/215件)

**根拠:** condB historical closing odds は完備 (100%)。次は skip6R switch 予備検証のためにデータ取得。

### 前提条件

- [ ] backup 実施
- [ ] dry-run 確認
- [ ] human approval
- [ ] condB coverage 100%

### 実行ステップ

1. backup を実施 ✅
   ```bash
   pnpm backup
   ```
2. 現状確認
   ```bash
   pnpm check:historical-alt-odds-quality
   ```
3. skip6R dry-run (5件)
   ```bash
   pnpm backfill:historical-alt-odds --limit 5 --priority skip6R
   ```
4. dry-run 結果を人間が確認 ⚠️ **人間確認が必要**
5. 小規模 write 30件
   ```bash
   pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000
   ```
6. quality check
   ```bash
   pnpm check:historical-alt-odds-quality
   ```
7. governor 更新
   ```bash
   pnpm report:research-governor
   ```
8. 満足なら残り write
   ```bash
   pnpm backfill:historical-alt-odds --limit 72 --priority skip6R --write --sleep-ms 1000
   ```

### 品質チェックリスト

- [ ] fetch 成功率 ≥ 95%
- [ ] 5買い目揃い率 ≥ 95%
- [ ] 同値率 0%
- [ ] 既存テーブル汚染なし

### write 許可

| 項目 | 内容 |
|---|---|
| write 許可 | ⚠️ 人間確認後に許可 |
| write 対象 | historical_alternative_odds のみ (既存テーブルへの書き込み禁止) |
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
| skip6R historical closing odds | 143/215 (67%) ❌ |
| skipVenue historical closing odds | 31/159 (19%) ❌ |
| future-only timeseries condB overlap | 0 ❌ (<30) |

## 仮説状態サマリ

| ID | 名前 | 状態 | 採用可否 |
|---|---|---|:---:|
| H001 | condB 1-3-2 switch | testing-historical | ❌ |
| H002 | condB skip | tested-historical | ❌ |
| H003 | 6R skip | monitor | ❌ |
| H004 | 6R switch (代替買い目) | waiting-data | ❌ |
| H005 | 浜名湖+住之江 skip | monitor | ❌ |
| H006 | 浜名湖+住之江 switch (代替買い目) | waiting-data | ❌ |
| H007 | condB 1-3-4 switch | secondary | ❌ |
| H008 | 1-3-5 / 1-3-6 switch | backlog | ❌ |
| H009 | 選手タイプ × 会場構造 | backlog | ❌ |
| H010 | 会場別着順構造 | backlog | ❌ |

---
*生成: plan-next-research-action.ts*