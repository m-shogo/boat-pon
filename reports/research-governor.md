# Research Governor

生成日時: 2026-06-09T12:40:39.363Z

> **⚠️ BUY は検証候補。ROI は検証指標。購入指示・採用判断ではない。**
> **app_settings / 本番 decision / 自動投票 は絶対に変更しない。**

---

## A. 現在フェーズ

| 項目 | 状態 |
|---|---|
| フェーズ | **research-monitor** (monitor-only) |
| app_settings 反映候補 | **なし** |
| 本番 decision 変更 | **禁止** |
| 自動投票 | **禁止** |
| forward baseline ROI | 87.12% (n=1522) |
| 採用可能な edge | **なし** |

## B. 次にやるべき1本

**skip6R historical alternative odds の小規模backfill準備 (162/215件未保存)**

> ⚠️ **書き込みを行う場合は以下の手順を守ること:**
> 1. backup を先に実行: `pnpm backup`
> 2. dry-run で確認: `pnpm backfill:historical-alt-odds --limit 5 --priority skip6R`
> 3. 人間確認後に小規模 write: `pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000`
> 4. historical_alternative_odds のみへの INSERT
> 5. 既存テーブルへの書き込みは禁止

## C. 今やってはいけないこと

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

## D. 仮説一覧

| ID | 名前 | 状態 | 採用可否 | 次アクション |
|---|---|---|:---:|---|
| H001 | condB 1-3-2 switch | 🔬 testing-historical | ❌ 不可 | future-only odds_timeseries confirmation (condB BUY overlap蓄積待ち) |
| H002 | condB skip | 🟠 tested-historical | ❌ 不可 | H001 と並行して monitor |
| H003 | 6R skip | 👁️ monitor | ❌ 不可 | pnpm report:paper-forward-monitor (monitor継続) |
| H004 | 6R switch (代替買い目) | ⏳ waiting-data | ❌ 不可 | pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000 (人間確認後・backup後) |
| H005 | 浜名湖+住之江 skip | 👁️ monitor | ❌ 不可 | pnpm report:paper-forward-monitor (monitor継続) |
| H006 | 浜名湖+住之江 switch (代替買い目) | ⏳ waiting-data | ❌ 不可 | H004完了後に着手 |
| H007 | condB 1-3-4 switch | 🔵 secondary | ❌ 不可 | condB 1-3-2 検証内で参考として監視 |
| H008 | 1-3-5 / 1-3-6 switch | 📋 backlog | ❌ 不可 | none |
| H009 | 選手タイプ × 会場構造 | 📋 backlog | ❌ 不可 | none |
| H010 | 会場別着順構造 | 📋 backlog | ❌ 不可 | none |

### H001 condB 1-3-2 switch 詳細

| 指標 | 値 |
|---|---|
| condB n | 167 |
| baseline 1-2-3 ROI | 65.6% |
| switch 1-3-2 ROI | **174.4%** |
| top2除外 ROI | **92.2%** ← 100%未達 ❌ |
| 2025-07除外 ROI | 162.4% |
| hybrid condB→1-3-2 ROI | 99.1% |
| skip残存 ROI | 89.8% |
| 直近3M n | 0 (データなし) |
| odds ソース | historical_closing_odds |
| future-only 確認 | ❌ 未確認 |
| **本採用判断** | **❌ 不可** |

**Gate 判定**

| Gate | 結果 |
|---|---|
| n ≥ 30 | ✅ |
| ROI > baseline | ✅ |
| top2除外ROI ≥ 100% | ❌ 92.2% |
| 直近3ヶ月 OK | ⚠️ 判定不可 (n=0) |
| future-only 確認済み | ❌ 未確認 |

## E. データ準備状況

| 項目 | 対象 | 保存済 | coverage |
|---|---:|---:|---:|
| condB historical closing odds | 167 | 167 | 100% |
| skip6R historical closing odds | 215 | 53 | 25% |
| skipVenue historical closing odds | 159 | 20 | 13% |
| timeseries BUY forward overlap (T-5) | — | 0 | — |
| timeseries condB overlap (T-5) | — | 0 | — |

| 項目 | 状態 |
|---|---|
| condB historical odds 完備 | ✅ 完了 |
| skip6R historical odds 完備 | ❌ 53/215 |
| skipVenue historical odds 完備 | ❌ 20/159 |
| future-only switch 評価可能 | ❌ condB overlap n=0 (<30) |
| timeseries 日付範囲 | なし |

## F. Gate 判定

| Gate 条件 | condB 1-3-2 | 6R skip | 6R switch |
|---|:---:|:---:|:---:|
| 必要データあり | ✅ | ✅ | ❌ 未取得 |
| データ品質 OK | ✅ | ✅ | — |
| n ≥ 30 | ✅ | ✅ | — |
| n ≥ 100 | ✅ | ✅ | — |
| ROI > baseline | ✅ (174.4% vs 65.6%) | ✅ (97.95%) | — |
| top2除外ROI ≥ 100% | ❌ 92.2% | ❌ 88.94% | — |
| 直近3M OK | ⚠️ n=0 | ✅ 83.5% | — |
| July-onlyではない | ✅ (162.4%) | ✅ | — |
| future-only 確認済 | ❌ | — | — |
| **本採用可** | **❌** | **❌** | **❌** |

## G. 状態分類

**🔬 testing-historical**: H001 condB 1-3-2 switch

**🟠 tested-historical**: H002 condB skip

**👁️ monitor**: H003 6R skip / H005 浜名湖+住之江 skip

**⏳ waiting-data**: H004 6R switch (代替買い目) / H006 浜名湖+住之江 switch (代替買い目)

**🔵 secondary**: H007 condB 1-3-4 switch

**📋 backlog**: H008 1-3-5 / 1-3-6 switch / H009 選手タイプ × 会場構造 / H010 会場別着順構造

## H. write 許可

**今回: 自動 write 禁止**

人間確認後に次回実行可能な候補:

```bash
# 1. 事前 backup
pnpm backup

# 2. dry-run 確認
pnpm backfill:historical-alt-odds --limit 5 --priority skip6R

# 3. 人間確認後・backup後・小規模 write (historical_alternative_odds のみ)
pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000
```

> ⚠️ 既存テーブル (odds_snapshots / odds_timeseries_snapshots) への書き込みは禁止

## I. 1行結論

> **次は skip6R historical alt odds の小規模backfill準備（人間確認後）。condB switchはhistorical上有望（174.4%）だがtop2=92.2%/future-only未確認のため本採用不可。**

---

## 注記

- condB 1-3-2 switch は **historical closing odds では有望** (ROI=174.4%)
- ただし **top2除外ROI=92.2% で 100% 未達** → 格上げ条件を満たさない
- **future-only odds_timeseries 未確認** → 本採用不可
- **historical closing odds は live/T-5 forward ではない**
- **app_settings 反映候補なし**
- **現時点で本採用可能な edge はなし**
- skip monitor は継続
- 1-3-5 / 1-3-6 の追加は過学習リスクのため禁止

---
*生成: report-research-governor.ts*