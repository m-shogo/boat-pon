# regenerated A/B review

## 目的
保存済みdecision_historyだけではできない motorあり/なし・設定あり/なし の比較を、同じ対象race inputでメモリ上再生成する土台です。DB書き込みはありません。

## scope
- period: 2024-01-01〜2026-05-21
- target race ids: 6260
- programs loaded: 6259
- note: 保存済みhistorical-backfill BUYのrace_id集合で再生成。全official_programs再生成ではない。

## saved decision_history baseline
- BUY=6249 hits=124 hitRate=1.98% avgOdds=44.339 ROI=0.805

## A/B再生成結果
| pattern | BUY件数 | 的中数 | 的中率 | avg odds | 投資 | 回収 | ROI | 最大1hit除外ROI | コメント |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline_before | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | venue motor/boatなし、旧raceNo、旧calibration |
| venue_motor_only | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | featureAdjustmentにvenue motorのみ |
| venue_motor_and_boat | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | featureAdjustmentにvenue motor/boat |
| excluded_10_11_12_only | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | 10R除外のみ追加 |
| max_motor_top2_50_national | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | national motor基準でmaxMotorTop2Rate=50 |
| max_motor_top2_50_venue | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | venue motor基準でmaxMotorTop2Rate=50 |
| calibration_040_all | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | 全帯0.40のみ |
| current_like | 1 | 0 | 0.00% | 96.600 | 100円 | 0円 | 0.000 | 0.000 | 現在設定に近い。filterは現実装同様national寄り |

## 判定
- ROI 1.118再現: no
- この土台ではROI 1.118は再現していない。厳密な全レース再生成には全official_programs + 全odds coverageが必要。
- このスクリプトは土台です。全official_programsでの完全再生成へ拡張すれば、保存BUY集合に限定しないA/Bが可能です。

