# exacta forward monitor

生成日時: 2026-06-12T16:46:39.481Z

> **post-hoc sweep候補を固定し、lockedAt以降だけを見る。BUY昇格・app_settings反映・decision logic変更は禁止。**
> **これは候補固定後のfuture-only validation monitorです。n=30到達前に候補追加・条件変更・採用判断をしないでください。**
> **Do not add, remove, or tune candidates until predefined review triggers are reached. n<30 is not evaluable.**
> **これは購入指示ではありません。BUY昇格・app_settings反映・decision logic変更・自動投票は禁止。**

## 固定条件

- lockedAt: 2026-06-12
- frozen: true
- freezeReason: post-hoc sweep candidates locked for future-only validation
- doNotEditUntilNote: 候補追加・削除・条件変更は、事前定義した forward n=30/50/100 の review trigger まで行わない。n<30で採用判断しない。
- sourceCommit: 1604905
- sourceReport: reports/exacta-market-residual-sweep.md
- baseRaceCount since lockedAt: 0
- basePopulation: run_kind=historical-backfill, decision=BUY, selection=1-2-3
- excludedStatuses: F* / L* (フライング・出遅れ等の返還/不成立系をfuture monitorから除外)
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

| candidate | lockedAt | matched | forward n | hit | actual | implied | edge_pp | ROI | max1x ROI | pending | unpriced | incomplete odds | payout pending | nextReview | status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| wind 2-3m × 2連単 1-4 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 0 | 0 | 0 | 0 | 30 | pending |
| 尼崎 × 2連単 1-3 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 0 | 0 | 0 | 0 | 30 | pending |
| 丸亀 × 2連単 1-2 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 0 | 0 | 0 | 0 | 30 | pending |
| 常滑 × 2連単 1-2 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 0 | 0 | 0 | 0 | 30 | pending |
| 大村 × 2連単 1-2 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 0 | 0 | 0 | 0 | 30 | pending |
| 3R × 2連単 1-4 | 2026-06-12 | 0 | 0 | 0 | - | - | - | - | - | 0 | 0 | 0 | 0 | 30 | pending |

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

