# regenerated A/B review

## 目的
保存済みdecision_historyだけではできない motorあり/なし・設定あり/なし の比較を、同じ対象race inputでメモリ上再生成する土台です。DB書き込みはありません。

## scope
- mode: odds-results
- period: 2024-01-01〜2026-05-21
- target race ids: 47958
- programs loaded: 47958
- note: 結果とodds_snapshotsがある期間内official_programs全体で再生成。保存BUY集合に限定しないpaper A/Bです。

## saved decision_history baseline
- BUY=6249 hits=124 hitRate=1.98% avgOdds=44.339 ROI=0.805

## A/B再生成結果
| pattern | BUY件数 | 的中数 | 的中率 | avg odds | 投資 | 回収 | ROI | 最大1hit除外ROI | コメント |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| baseline_before | 6 | 0 | 0.00% | 95.067 | 600円 | 0円 | 0.000 | 0.000 | venue motor/boatなし、旧raceNo、旧calibration |
| venue_motor_only | 7 | 0 | 0.00% | 94.500 | 700円 | 0円 | 0.000 | 0.000 | featureAdjustmentにvenue motorのみ |
| venue_motor_and_boat | 7 | 0 | 0.00% | 94.500 | 700円 | 0円 | 0.000 | 0.000 | featureAdjustmentにvenue motor/boat |
| excluded_10_11_12_only | 6 | 0 | 0.00% | 95.067 | 600円 | 0円 | 0.000 | 0.000 | 10R除外のみ追加 |
| max_motor_top2_50_national | 6 | 0 | 0.00% | 95.067 | 600円 | 0円 | 0.000 | 0.000 | national motor基準でmaxMotorTop2Rate=50 |
| max_motor_top2_50_venue | 5 | 0 | 0.00% | 94.240 | 500円 | 0円 | 0.000 | 0.000 | venue motor基準でmaxMotorTop2Rate=50 |
| calibration_040_all | 6 | 0 | 0.00% | 95.067 | 600円 | 0円 | 0.000 | 0.000 | 全帯0.40のみ |
| current_like | 7 | 0 | 0.00% | 94.500 | 700円 | 0円 | 0.000 | 0.000 | 現在設定に近い。filterは現実装同様national寄り |

## 判定
- ROI 1.118再現: no
- 結果とoddsがあるofficial_programs全体に広げてもROI 1.118は再現しない。保存履歴との差は、motor/boat単体効果よりも現行の候補生成・設定・保存履歴生成時点の差分が主因の可能性が高い。
- 次は、保存済みdecision_history生成時の設定・候補selection・odds取得条件をrace単位で突き合わせ、BUY件数が6249件から7件へ縮む原因を特定します。

