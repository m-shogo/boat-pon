# Research Governor

生成日時: 2026-06-11T06:48:40.761Z

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

**switch検証は全て完了 (H004/H006 とも switch reject)。condB timeseries overlap 蓄積待ち / H011 1-4系 forward monitor 継続**

実行候補: `pnpm report:h011-forward-monitor (H011固定監視) / pnpm report:paper-forward-monitor`

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
| H011 | 1-4系 市場過小評価 (2連単1-4) | 🟠 tested-historical | ❌ 不可 | forward monitor: 2026-06以降のBUYレースで2連単1-4相当の的中/払戻を追跡。条件追加でのROI掘りは禁止 |
| H004 | 6R switch (代替買い目) | 🟠 tested-historical | ❌ 不可 | switch は終了。6R の扱いは H003 (skip monitor) に一本化 |
| H005 | 浜名湖+住之江 skip | 👁️ monitor | ❌ 不可 | pnpm report:paper-forward-monitor (monitor継続)。2026-06以降のforwardでvenue 1-2-3のhit有無を追跡 |
| H006 | 浜名湖+住之江 switch (代替買い目) | 🟠 tested-historical | ❌ 不可 | switch は終了。venue の扱いは H005 (skip monitor) に一本化 |
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
| skip6R historical closing odds | 215 | 215 | 100% |
| skipVenue historical closing odds | 159 | 159 | 100% |
| timeseries BUY forward overlap (T-5) | — | 0 | — |
| timeseries condB overlap (T-5) | — | 0 | — |

| 項目 | 状態 |
|---|---|
| condB historical odds 完備 | ✅ 完了 |
| skip6R historical odds 完備 | ✅ |
| skipVenue historical odds 完備 | ✅ |
| future-only switch 評価可能 | ❌ condB overlap n=0 (<30) |
| timeseries 日付範囲 | なし |

## F. Gate 判定

| Gate 条件 | condB 1-3-2 | 6R skip (H003) | 6R switch (H004) | venue skip (H005) | venue switch (H006) |
|---|:---:|:---:|:---:|:---:|:---:|
| historical closing odds 完備 | ✅ 167/167 | ✅ 215/215 | ✅ 215/215 | ✅ 159/159 | ✅ 159/159 |
| データ品質 OK | ✅ | ✅ | ✅ | ✅ | ✅ |
| n ≥ 100 | ✅ | ✅ | ✅ | ✅ | ✅ |
| ROI > baseline | ✅ (174.4% vs 65.6%) | ✅ (97.95%) | ❌ 全候補<100% | ✅ (97.3%) | ❌ 安定候補なし |
| top2除外ROI ≥ 100% | ❌ 92.2% | ❌ 88.94% | ❌ best 39.7% | ❌ 88.8% | ❌ best 29.4% |
| 期間依存なし | ✅ (162.4%) | ✅ | ❌ 0hit月4〜7 | ⚠️ forward要確認 | ❌ 0hit月6〜8 |
| future-only 確認済 | ❌ | — (monitor) | 未対象 | — (monitor) | 未対象 |
| switch 判定 | watch | — | **reject** | — | **reject** |
| skip 判定 | — | watch | — | watch | — |
| **本採用可 (app_settings反映)** | **❌** | **❌** | **❌** | **❌** | **❌** |

## G. 状態分類

**🔬 testing-historical**: H001 condB 1-3-2 switch

**🟠 tested-historical**: H002 condB skip / H011 1-4系 市場過小評価 (2連単1-4) / H004 6R switch (代替買い目) / H006 浜名湖+住之江 switch (代替買い目)

**👁️ monitor**: H003 6R skip / H005 浜名湖+住之江 skip

**🔵 secondary**: H007 condB 1-3-4 switch

**📋 backlog**: H008 1-3-5 / 1-3-6 switch / H009 選手タイプ × 会場構造 / H010 会場別着順構造

## H. write 許可

**今回: 自動 write 禁止**

**現時点で historical closing odds backfill の write 候補なし** (condB 167/167 / skip6R 215/215 / skipVenue 159/159 すべて完走済み)。

次は monitor 継続、または全券種ROIシミュレーター (読み取り専用) が候補。完了済み backfill を再実行しないこと。

> ⚠️ 既存テーブル (odds_snapshots / odds_timeseries_snapshots) への書き込みは禁止

## I. 1行結論

> **次は「switch検証は全て完了 (H004/H006 とも switch reject)。condB timeseries overlap 蓄積待ち / H011 1-4系 forward monitor 継続」（write系は人間確認後）。switch検証: H004 6R=reject / H006 venue=reject / H001 condBはfuture-only timeseries overlap蓄積待ち（historical 174.4%だがtop2=92.2%）。skip: H003 6R / H005 venueともwatch（top2除外<100%・in-sampleバイアスありforward確認要）。本採用可能な edge はなし。次の大型候補は全券種ROIシミュレーター。**

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