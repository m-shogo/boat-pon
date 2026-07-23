# H011 「1-4系 市場過小評価」 forward モニター

生成日時: 2026-07-20T04:16:22.717Z
monitor 開始日: **2026-06-01** (run_kind=paper-live)

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**
> **これは H011 を未来データで検証する箱。条件追加・ROI掘りは禁止。app_settings 反映禁止。**
> **backtest (9fb13c3) で見えた条件付き>100% は in-sample 条件選択であり、forward での再現を待つ。**

---

## 監視対象の定義 (固定)

| ID | 条件 | 定義 |
|---|---|---|
| H011-A | 2連単 1-4 全体 | 現行BUY集合 (selection=1-2-3) の全レースで exacta 1-4 を1点100円 |
| H011-B | × 風速2-3m/s | race_weather.wind_speed_mps が `2 ≤ ws < 4` |
| H011-C | × 4号艇モーター上位 | 4号艇の motor_top2_rate がレース内6艇中 top2 (構造検証スクリプトと同一定義) |

> **H011-B 境界注記**: backtest の「2-3m/s帯」は構造検証スクリプトの windBand 定義 `2 ≤ ws < 4` と同一。
> 3.x m/s を含み 4.0 を含まない (condB の風速2-4帯と同じ境界)。この定義で backtest n=694 / ROI=113.5% を得た。
> **H011-C 定義**: 構造検証 (9fb13c3) で「motorTop4 = 4号艇の motor_top2_rate が降順 top2」とした定義を踏襲。

---

## forward 集計サマリ

| 項目 | 値 |
|---|---|
| monitor 開始日 | 2026-06-01 |
| forward 対象レース総数 | 1 |
| うち exacta 確定済み | 0 |
| うち未確定 (pending) | 1 |
| 判定最低 n_resolved / hits | 30 / 3 |

---

## run_kind 診断 (未来検証データの取りこぼし防止)

> このモニターは run_kind=**paper-live** のみを対象にしている。
> 将来 paper-forward / live-forward 的な別 run_kind が入った場合、その行が
> `2026-06-01以降` 列に件数を持っていれば、monitor の対象 run_kind を見直す必要がある。

| run_kind | 全件数 | 期間 | 2026-06-01以降 | monitor対象 |
|---|---:|---|---:|:---:|
| historical-backfill | 6164 | 2024-01-01〜2026-05-29 | 0 | — |
| paper-live | 1 | 2026-07-20〜2026-07-20 | 1 | ✅ |

| 確認項目 | 値 |
|---|---|
| decision_history 最新 BUY date | 2026-07-20 |
| monitor 対象 run_kind | paper-live |
| 未カバー run_kind (2026-06-01以降に件数あり) | なし ✅ |

---

## 条件別 forward 結果 (backtest / held-out 基準と並列表示)

> **⚠️ held-out検証 (2026-06-12)**: H011発見に未使用の2024訓練期BUY 2779レースで再テストした結果、
> 条件付き>100%は再現しなかった (B: 113.5%→76.8% / C: 112.1%→83.0%)。
> 2着分布の傾き (4号艇>2号艇) は再現 → 構造は本物だがROI優位は期間依存。forward は両基準と比較する。

| ID | 条件 | backtest 2025+ ROI (n) | held-out 2024 ROI (n) | forward n_total | resolved | pending | hits | forward ROI | top2除外 | 最大連敗 | 判定 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| H011-A | 2連単 1-4 全体 | 94.7% (n=1522) | 75.9% (n=2779) | 1 | 0 | 1 | 0 | — | — | 0 | **pending** |
| H011-B | 2連単 1-4 × 風速2-3m/s | 113.5% (n=694) | 76.8% (n=1405) | 1 | 0 | 1 | 0 | — | — | 0 | **pending** |
| H011-C | 2連単 1-4 × 4号艇モーター上位 | 112.1% (n=538) | 83.0% (n=1029) | 0 | 0 | 0 | 0 | — | — | 0 | **pending** |

---

## 各条件 詳細

### H011-A: 2連単 1-4 全体

**backtest 基準 (9fb13c3、採用ではない)**: ROI 94.7% / top2除外 88.6% / n=1522

| 項目 | forward 値 |
|---|---|
| n_total (条件該当) | 1 |
| 特徴量不明で除外 | 0 |
| n_resolved (確定) | 0 |
| n_pending (未確定) | 1 |
| hits / 的中率 | 0 / — |
| stake / payout / profit | 0円 / 0円 / 0円 |
| ROI | — (pending) |
| top1除外 / top2除外 ROI | — |
| 最大連敗 | 0 |
| avg / med 払戻 | — / — |
| 判定 | **pending** — 確定レースなし (pending=1)。forward データ蓄積待ち |

---

### H011-B: 2連単 1-4 × 風速2-3m/s

**backtest 基準 (9fb13c3、採用ではない)**: ROI 113.5% / top2除外 103.4% / n=694

| 項目 | forward 値 |
|---|---|
| n_total (条件該当) | 1 |
| 特徴量不明で除外 | 0 |
| n_resolved (確定) | 0 |
| n_pending (未確定) | 1 |
| hits / 的中率 | 0 / — |
| stake / payout / profit | 0円 / 0円 / 0円 |
| ROI | — (pending) |
| top1除外 / top2除外 ROI | — |
| 最大連敗 | 0 |
| avg / med 払戻 | — / — |
| 判定 | **pending** — 確定レースなし (pending=1)。forward データ蓄積待ち |

---

### H011-C: 2連単 1-4 × 4号艇モーター上位

**backtest 基準 (9fb13c3、採用ではない)**: ROI 112.1% / top2除外 99.5% / n=538

| 項目 | forward 値 |
|---|---|
| n_total (条件該当) | 0 |
| 特徴量不明で除外 | 1 |
| n_resolved (確定) | 0 |
| n_pending (未確定) | 0 |
| hits / 的中率 | 0 / — |
| stake / payout / profit | 0円 / 0円 / 0円 |
| ROI | — (pending) |
| top1除外 / top2除外 ROI | — |
| 最大連敗 | 0 |
| avg / med 払戻 | — / — |
| 判定 | **pending** — 対象レースなし。2026-06-01以降のBUYレース待ち |

---

## review trigger

- **H011-A** が n_resolved ≥ 30 に到達 → forward ROI を backtest 94.7% と比較
- **H011-B / H011-C** が n_resolved ≥ 30 に到達 → 条件付き優位が forward で再現するか確認
- いずれも forward ROI ≥ 100% かつ top2除外 ≥ 100% が継続して初めて「edge候補」
- **それでも app_settings 反映は不可** (forward の事前オッズ検証・複数期間確認が前提)

## 注記

- pending (exacta未確定) は 0円負けに混ぜず、resolved からも除外している
- forward 単独で ROI>100% でも、それは1期間の結果であり採用条件ではない
- 条件追加・風向/会場での再探索は禁止 (過学習防止)
- 自動投票・購入推奨ではない

---
*生成: report-h011-forward-monitor.ts*