# network-only T-5 future評価

生成日時: 2026-07-23T07:30:12.636Z

> 2026-07-21 15:15 JST以降の単一captured_at完全市場だけをformal futureとして評価。読み取り専用・本番未接続。

## Coverage

- 締切済み: 325
- network-only T-5完全: 281
- 結果確定・評価可能: 52 / 1,000
- 返還・未確定: 229

## 同一race_id比較

| モデル | n | 的中 | 的中率 | 実払戻ROI | 最大1的中除外ROI | 最大2的中除外ROI | logloss | Brier | 最大DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T-5市場 | 52 | 5 | 9.62% | 64.23% | 40.98% | 29.60% | 3.7434 | 0.9516 | ¥2,660 |
| 市場temperature T=0.9 | 52 | 5 | 9.62% | 64.23% | 40.98% | 29.60% | 3.7268 | 0.9499 | ¥2,660 |
| 買い目残差 T=1 prior=30 | 52 | 5 | 9.62% | 67.31% | 50.59% | 34.60% | 3.9641 | 0.9669 | ¥2,400 |

## Gate

- BLOCKED: settled1000
- BLOCKED: residualLogLoss
- BLOCKED: residualBrier
- BLOCKED: residualPayoutRoi
- BLOCKED: residualPayoutRoiExTop2
- BLOCKED: clv
- 最終判定: **BLOCKED**

## 未計測

- CLV: 同一selectionのT-5とclosing oddsを時点整合付きで結合する正式器が未完成
- 現行モデルの多クラス比較: decision_historyは選択買い目の確率だけで、120通り分布のlogloss/Brierと同尺度比較できない
