# exacta forward monitor

生成日時: 2026-06-12T02:14:16.776Z

> **post-hoc sweep候補を固定し、lockedAt以降だけを見る。BUY昇格・app_settings反映・decision logic変更は禁止。**
> **これは購入指示ではありません。BUY昇格・app_settings反映・decision logic変更・自動投票は禁止。**

## 固定条件

- lockedAt: 2026-06-12
- sourceCommit: 1604905
- sourceReport: reports/exacta-market-residual-sweep.md
- baseRaceCount since lockedAt: 0
- basePopulation: run_kind=historical-backfill, decision=BUY, selection=1-2-3
- excludedVenues: 戸田, 多摩川, 桐生, 三国, 江戸川
- excludedRaceNos: 10, 11, 12

## Review Policy

- forward n < 30 は評価しない
- n >= 30 かつ hit < 3 は参考
- n >= 50 かつ ROI < 90% は rejected寄り
- n >= 100 かつ ROI > 105%、max1hit > 95%、edge_pp > 0 は manual review
- n >= 100 までは BUY昇格なし
- manual review 到達後も BUY昇格ではなく paper 継続を基本にする

## Candidates

| candidate | lockedAt | matched | forward n | hit | actual | implied | edge_pp | ROI | max1x ROI | nextReview | status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| wind 2-3m × 2連単 1-4 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 30 | pending |
| 尼崎 × 2連単 1-3 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 30 | pending |
| 丸亀 × 2連単 1-2 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 30 | pending |
| 常滑 × 2連単 1-2 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 30 | pending |
| 大村 × 2連単 1-2 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 30 | pending |
| 3R × 2連単 1-4 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 30 | pending |

## Status Reasons

- wind2_3m_exacta_1_4: forward n < 30 のため評価しない
- amagasaki_exacta_1_3: forward n < 30 のため評価しない
- marugame_exacta_1_2: forward n < 30 のため評価しない
- tokoname_exacta_1_2: forward n < 30 のため評価しない
- omura_exacta_1_2: forward n < 30 のため評価しない
- race3_exacta_1_4: forward n < 30 のため評価しない

## Excluded From Lock

- odds05_10_exacta_1_4: forward ROI 88.0% / max1x 85.5%。normalized implied上は良く見えても realized ROI で価格負け。
- race7_exacta_1_3: forward ROI 100.7% だが max1x 87.1%。1本依存が残るため優先候補から除外。必要なら low-priority watch。

## Monthly Detail

### wind 2-3m × 2連単 1-4

- lockedAt以降の確定済み対象レースなし

### 尼崎 × 2連単 1-3

- lockedAt以降の確定済み対象レースなし

### 丸亀 × 2連単 1-2

- lockedAt以降の確定済み対象レースなし

### 常滑 × 2連単 1-2

- lockedAt以降の確定済み対象レースなし

### 大村 × 2連単 1-2

- lockedAt以降の確定済み対象レースなし

### 3R × 2連単 1-4

- lockedAt以降の確定済み対象レースなし

