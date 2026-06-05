# 買い方別ROIシミュレーション

## 1. 現状1点BUY
- 対象期間: 2024-01-01 〜 2026-05-21
- 対象: `run_kind='historical-backfill' AND decision='BUY' AND current_odds IS NOT NULL AND result IS NOT NULL`
- BUYは購入指示ではなく検証候補。自動投票・ログイン保存・投票サイト操作は対象外。
- BUY件数: 6260
- 的中数: 124
- 的中率: 1.98%
- 平均odds: 44.34
- 平均的中odds: 40.58
- 投資額: 626,000円
- 回収額: 503,160円
- ROI: 80.38%

## 2. 買い方別比較
| strategy | races | total_tickets | avg_tickets_per_race | hit_races | hit_rate | avg_ticket_odds | avg_hit_odds | stake | return | ROI | 欠損率 | 最大1hit除外ROI |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| original_single | 6260 | 6260 | 1.00 | 124 | 1.98% | 44.34 | 40.58 | 626,000円 | 503,160円 | 80.38% | 0.00% | 79.14% |
| first_second_third_flow | 6260 | 6450 | 1.03 | 127 | 2.03% | 44.52 | 40.81 | 645,000円 | 518,250円 | 80.35% | 74.24% | 79.14% |
| first_third_second_flow | 6260 | 6260 | 1.00 | 124 | 1.98% | 44.34 | 40.58 | 626,000円 | 503,160円 | 80.38% | 75.00% | 79.14% |
| first_fixed_second_third_flow | 6260 | 7000 | 1.12 | 138 | 2.20% | 44.91 | 40.90 | 700,000円 | 564,480円 | 80.64% | 94.41% | 79.53% |
| top3_box | 6260 | 6720 | 1.07 | 134 | 2.14% | 44.73 | 40.62 | 672,000円 | 544,340円 | 81.00% | 82.11% | 79.85% |
| top4_box | 6260 | 6832 | 1.09 | 137 | 2.19% | 44.81 | 40.83 | 683,200円 | 559,430円 | 81.88% | 95.45% | 80.75% |
| second_third_reverse | 6260 | 6720 | 1.07 | 134 | 2.14% | 44.73 | 40.62 | 672,000円 | 544,340円 | 81.00% | 46.33% | 79.85% |
| first_second_flow_odds_min_5 | 6260 | 6450 | 1.03 | 127 | 2.03% | 44.52 | 40.81 | 645,000円 | 518,250円 | 80.35% | 74.24% | 79.14% |
| first_second_flow_odds_min_8 | 6260 | 6450 | 1.03 | 127 | 2.03% | 44.52 | 40.81 | 645,000円 | 518,250円 | 80.35% | 74.24% | 79.14% |
| first_second_flow_odds_min_10 | 6260 | 6450 | 1.03 | 127 | 2.03% | 44.52 | 40.81 | 645,000円 | 518,250円 | 80.35% | 74.24% | 79.14% |
| box_only_when_order_uncertain | 6260 | 6708 | 1.07 | 133 | 2.12% | 44.76 | 40.74 | 670,800円 | 541,800円 | 80.77% | 80.91% | 79.61% |

## 3. 的中率とROIの関係
| strategy | 分類 | hit_rate | ROI | コメント |
|---|---|---:|---:|---|
| original_single | 基準 | 1.98% | 80.38% | 比較の基準。 |
| first_second_third_flow | B. 的中率は上がるがROIは下がる | 2.03% | 80.35% | 的中率だけ上がる買い方。常用は危険。 |
| first_third_second_flow | D. どちらも下がる | 1.98% | 80.38% | 1点維持またはNO BUY優先。 |
| first_fixed_second_third_flow | A. 的中率もROIも上がる | 2.20% | 80.64% | 有望だが過学習確認必須。 |
| top3_box | A. 的中率もROIも上がる | 2.14% | 81.00% | 有望だが過学習確認必須。 |
| top4_box | A. 的中率もROIも上がる | 2.19% | 81.88% | 有望だが過学習確認必須。 |
| second_third_reverse | A. 的中率もROIも上がる | 2.14% | 81.00% | 有望だが過学習確認必須。 |
| first_second_flow_odds_min_5 | B. 的中率は上がるがROIは下がる | 2.03% | 80.35% | 的中率だけ上がる買い方。常用は危険。 |
| first_second_flow_odds_min_8 | B. 的中率は上がるがROIは下がる | 2.03% | 80.35% | 的中率だけ上がる買い方。常用は危険。 |
| first_second_flow_odds_min_10 | B. 的中率は上がるがROIは下がる | 2.03% | 80.35% | 的中率だけ上がる買い方。常用は危険。 |
| box_only_when_order_uncertain | A. 的中率もROIも上がる | 2.12% | 80.77% | 有望だが過学習確認必須。 |

## 4. 惜しい外れ分析
| 分類 | n | 比率 | 示唆 |
|---|---:|---:|---|
| 頭は合っていた | 2381 | 38.80% | 1着固定流しの検証価値 |
| 1着2着は合っていたが3着違い | 418 | 6.81% | 1-2-流しの検証価値 |
| 1着3着は合っていたが2着違い | 374 | 6.10% | 1着3着固定・2着流しの検証価値 |
| 2着3着が逆だった | 128 | 2.09% | 2着3着逆転保険の検証価値 |
| selectionの3艇は全部入っていたが順番違い | 321 | 5.23% | 3艇BOXの検証価値 |
| 完全に違った | 3562 | 58.05% | 買い方拡張よりNO BUY優先 |

## 5. 会場別おすすめstrategy
| venue | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 児島 | original_single | 157.14% | 157.14% | 224 | 1点維持候補 |
| 芦屋 | original_single | 147.31% | 147.31% | 219 | 1点維持候補 |
| 常滑 | original_single | 121.70% | 121.70% | 324 | 1点維持候補 |
| 平和島 | original_single | 114.02% | 114.02% | 261 | 1点維持候補 |
| びわこ | original_single | 111.90% | 111.90% | 284 | 1点維持候補 |
| 津 | original_single | 104.71% | 104.71% | 242 | 1点維持候補 |
| 唐津 | original_single | 97.65% | 97.65% | 289 | 1点維持候補 |
| 大村 | original_single | 87.38% | 87.38% | 256 | 1点維持候補 |
| 宮島 | original_single | 84.69% | 84.69% | 277 | 1点維持候補 |
| 若松 | original_single | 82.09% | 82.09% | 292 | 1点維持候補 |
| 丸亀 | original_single | 82.06% | 82.06% | 223 | 1点維持候補 |
| 尼崎 | original_single | 78.61% | 78.61% | 216 | 1点維持候補 |
| 蒲郡 | original_single | 77.52% | 77.52% | 330 | 1点維持候補 |
| 鳴門 | original_single | 76.04% | 76.04% | 202 | 1点維持候補 |
| 下関 | original_single | 72.90% | 72.90% | 241 | 1点維持候補 |
| 浜名湖 | original_single | 71.63% | 71.63% | 283 | 1点維持候補 |
| 福岡 | original_single | 68.00% | 68.00% | 260 | 1点維持候補 |
| 徳山 | original_single | 67.11% | 67.11% | 242 | 1点維持候補 |
| 住之江 | original_single | 60.00% | 60.00% | 225 | 1点維持候補 |
| 江戸川 | original_single | 54.14% | 54.14% | 186 | 1点維持候補 |
| 三国 | original_single | 49.89% | 49.89% | 276 | 1点維持候補 |
| 桐生 | original_single | 41.40% | 41.40% | 307 | 1点維持候補 |
| 多摩川 | original_single | 28.79% | 28.79% | 282 | 1点維持候補 |
| 戸田 | original_single | 16.36% | 16.36% | 319 | 1点維持候補 |

## 6. odds帯別おすすめstrategy
| odds帯 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 30 <= odds < 50 | original_single | 82.63% | 82.63% | 3846 | 1点維持候補 |
| odds >= 50 | original_single | 76.85% | 76.85% | 1800 | 1点維持候補 |
| 20 <= odds < 30 | original_single | 72.55% | 72.55% | 603 | 1点維持候補 |

### raceNo別
| raceNo | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 9R | original_single | 114.60% | 114.60% | 433 | 1点維持候補 |
| 3R | original_single | 100.73% | 100.73% | 689 | 1点維持候補 |
| 7R | original_single | 94.48% | 94.48% | 715 | 1点維持候補 |
| 1R | original_single | 92.85% | 92.85% | 312 | 1点維持候補 |
| 6R | original_single | 91.13% | 91.13% | 779 | 1点維持候補 |
| 8R | original_single | 90.08% | 90.08% | 636 | 1点維持候補 |
| 4R | original_single | 78.08% | 78.08% | 772 | 1点維持候補 |
| 2R | original_single | 66.97% | 66.97% | 604 | 1点維持候補 |
| 5R | original_single | 63.23% | 63.23% | 699 | 1点維持候補 |
| 10R | original_single | 42.38% | 42.38% | 340 | 1点維持候補 |
| 11R | original_single | 0.00% | 0.00% | 192 | 1点維持候補 |
| 12R | original_single | 0.00% | 0.00% | 89 | 1点維持候補 |

### selection頭別
| 頭 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 1号艇頭 | original_single | 80.38% | 80.38% | 6260 | 1点維持候補 |

### データ有無・水面別
| 天候 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 天候あり | original_single | 80.52% | 80.52% | 6208 | 1点維持候補 |
| 天候なし | original_single | 63.27% | 63.27% | 52 | 1点維持候補 |

| 展示 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 展示あり | original_single | 80.52% | 80.52% | 6208 | 1点維持候補 |
| 展示なし | original_single | 63.27% | 63.27% | 52 | 1点維持候補 |

| F | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| F情報あり | original_single | 80.13% | 80.13% | 6259 | 1点維持候補 |

| 風速 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 5 <= wind < 8 | original_single | 89.21% | 89.21% | 900 | 1点維持候補 |
| 3 <= wind < 5 | original_single | 85.90% | 85.90% | 2381 | 1点維持候補 |
| wind < 3 | original_single | 73.85% | 73.85% | 2800 | 1点維持候補 |
| wind >= 8 | original_single | 67.32% | 67.32% | 123 | 1点維持候補 |
| 風速なし | original_single | 58.75% | 58.75% | 56 | 1点維持候補 |

| 波高 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 3 <= wave < 5 | original_single | 100.86% | 100.86% | 1882 | 1点維持候補 |
| wave < 3 | original_single | 72.03% | 72.03% | 3567 | 1点維持候補 |
| wave >= 5 | original_single | 70.37% | 70.37% | 755 | 1点維持候補 |
| 波高なし | original_single | 58.75% | 58.75% | 56 | 1点維持候補 |

## 8. motor_boat_statsと買い方
### motor帯別おすすめstrategy
| motor | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| 25 <= venueMotorTop2Rate < 35 | original_single | 91.22% | 91.22% | 3013 | 1点維持候補 |
| venueMotorTop2Rate < 25 | original_single | 74.78% | 74.78% | 810 | 1点維持候補 |
| 35 <= venueMotorTop2Rate < 50 | original_single | 71.29% | 71.29% | 2247 | 1点維持候補 |
| venueMotorTop2Rate >= 50 | original_single | 29.93% | 29.93% | 143 | 1点維持候補 |

### boat帯別おすすめstrategy
| boat | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|
| venueBoatTop2Rate < 25 | original_single | 120.69% | 120.69% | 890 | 1点維持候補 |
| venueBoatTop2Rate >= 50 | original_single | 97.88% | 97.88% | 179 | 1点維持候補 |
| 25 <= venueBoatTop2Rate < 35 | original_single | 73.44% | 73.44% | 2818 | 1点維持候補 |
| 35 <= venueBoatTop2Rate < 50 | original_single | 72.22% | 72.22% | 2326 | 1点維持候補 |

| motor_condition | strategy | n | hit_rate | avg_odds | ROI | 欠損率 | コメント |
|---|---|---:|---:|---:|---:|---:|---|
| venue motor/boatあり | top4_box | 6213 | 2.17% | 44.87 | 81.97% | 95.45% | odds欠損が多く参考扱い |
| venue motor/boatあり | top3_box | 6213 | 2.12% | 44.79 | 81.08% | 82.10% | odds欠損が多く参考扱い |
| venue motor/boatあり | second_third_reverse | 6213 | 2.12% | 44.79 | 81.08% | 46.30% | 単独では弱い |
| venue motor/boatあり | first_fixed_second_third_flow | 6213 | 2.19% | 44.98 | 80.71% | 94.40% | odds欠損が多く参考扱い |
| venue motor/boatあり | original_single | 6213 | 1.96% | 44.41 | 80.46% | 0.00% | 単独では弱い |
| venue motor/boatあり | first_second_third_flow | 6213 | 2.01% | 44.59 | 80.42% | 74.24% | 単独では弱い |
| venue motor/boat欠損 | original_single | 47 | 4.26% | 35.80 | 70.00% | 0.00% | n不足 |
| venue motor/boat欠損 | first_second_third_flow | 47 | 4.26% | 35.80 | 70.00% | 75.00% | n不足 |
| venue motor/boat欠損 | first_fixed_second_third_flow | 47 | 4.26% | 35.80 | 70.00% | 95.00% | n不足 |
| venue motor/boat欠損 | top3_box | 47 | 4.26% | 35.80 | 70.00% | 83.33% | n不足 |
| venue motor/boat欠損 | top4_box | 47 | 4.26% | 35.80 | 70.00% | 95.83% | n不足 |
| venue motor/boat欠損 | second_third_reverse | 47 | 4.26% | 35.80 | 70.00% | 50.00% | n不足 |
| venueBoatTop2Rate < 35 | first_second_third_flow | 3708 | 2.08% | 45.23 | 85.33% | 74.27% | 単独では弱い |
| venueBoatTop2Rate < 35 | original_single | 3708 | 2.02% | 45.06 | 84.78% | 0.00% | 単独では弱い |
| venueBoatTop2Rate < 35 | top4_box | 3708 | 2.16% | 45.43 | 84.48% | 95.48% | odds欠損が多く参考扱い |
| venueBoatTop2Rate < 35 | first_fixed_second_third_flow | 3708 | 2.18% | 45.51 | 83.82% | 94.45% | odds欠損が多く参考扱い |
| venueBoatTop2Rate < 35 | top3_box | 3708 | 2.10% | 45.34 | 82.94% | 82.19% | odds欠損が多く参考扱い |
| venueBoatTop2Rate < 35 | second_third_reverse | 3708 | 2.10% | 45.34 | 82.94% | 46.56% | 単独では弱い |
| venueBoatTop2Rate >= 50 | top3_box | 179 | 3.35% | 41.76 | 98.82% | 81.10% | odds欠損が多く参考扱い |
| venueBoatTop2Rate >= 50 | top4_box | 179 | 3.35% | 41.76 | 98.82% | 95.27% | odds欠損が多く参考扱い |
| venueBoatTop2Rate >= 50 | second_third_reverse | 179 | 3.35% | 41.76 | 98.82% | 43.30% | 単独では弱い |
| venueBoatTop2Rate >= 50 | original_single | 179 | 2.79% | 41.14 | 97.88% | 0.00% | 単独では弱い |
| venueBoatTop2Rate >= 50 | first_fixed_second_third_flow | 179 | 3.35% | 41.84 | 95.98% | 94.16% | odds欠損が多く参考扱い |
| venueBoatTop2Rate >= 50 | first_second_third_flow | 179 | 2.79% | 41.38 | 95.74% | 74.44% | 単独では弱い |
| venueMotorTop2Rate < 35 | original_single | 3823 | 2.09% | 45.07 | 87.73% | 0.00% | 単独では弱い |
| venueMotorTop2Rate < 35 | top4_box | 3823 | 2.30% | 45.55 | 87.39% | 95.43% | odds欠損が多く参考扱い |
| venueMotorTop2Rate < 35 | first_second_third_flow | 3823 | 2.14% | 45.24 | 87.17% | 74.25% | 単独では弱い |
| venueMotorTop2Rate < 35 | top3_box | 3823 | 2.25% | 45.48 | 86.97% | 82.04% | odds欠損が多く参考扱い |
| venueMotorTop2Rate < 35 | second_third_reverse | 3823 | 2.25% | 45.48 | 86.97% | 46.13% | 単独では弱い |
| venueMotorTop2Rate < 35 | first_fixed_second_third_flow | 3823 | 2.33% | 45.64 | 86.61% | 94.40% | odds欠損が多く参考扱い |
| venueMotorTop2Rate >= 50 | top3_box | 143 | 1.40% | 47.16 | 67.02% | 82.40% | odds欠損が多く参考扱い |
| venueMotorTop2Rate >= 50 | second_third_reverse | 143 | 1.40% | 47.16 | 67.02% | 47.20% | 単独では弱い |
| venueMotorTop2Rate >= 50 | top4_box | 143 | 1.40% | 47.30 | 66.14% | 95.54% | odds欠損が多く参考扱い |
| venueMotorTop2Rate >= 50 | first_fixed_second_third_flow | 143 | 1.40% | 47.39 | 64.05% | 94.48% | odds欠損が多く参考扱い |
| venueMotorTop2Rate >= 50 | original_single | 143 | 0.70% | 47.20 | 29.93% | 0.00% | 単独では弱い |
| venueMotorTop2Rate >= 50 | first_second_third_flow | 143 | 0.70% | 47.62 | 29.32% | 74.48% | 単独では弱い |
| venueMotorTop2Rate 35-50 | top4_box | 2247 | 2.00% | 43.57 | 73.65% | 95.47% | odds欠損が多く参考扱い |
| venueMotorTop2Rate 35-50 | first_second_third_flow | 2247 | 1.87% | 43.29 | 72.19% | 74.20% | 単独では弱い |
| venueMotorTop2Rate 35-50 | top3_box | 2247 | 1.96% | 43.46 | 71.87% | 82.18% | odds欠損が多く参考扱い |
| venueMotorTop2Rate 35-50 | second_third_reverse | 2247 | 1.96% | 43.46 | 71.87% | 46.53% | 単独では弱い |
| venueMotorTop2Rate 35-50 | first_fixed_second_third_flow | 2247 | 2.00% | 43.68 | 71.69% | 94.41% | odds欠損が多く参考扱い |
| venueMotorTop2Rate 35-50 | original_single | 2247 | 1.82% | 43.10 | 71.29% | 0.00% | 単独では弱い |

## 9. 流しが有効な条件
| 条件 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|

## 10. BOXが有効な条件
| 条件 | best_strategy | original ROI | best ROI | n | コメント |
|---|---|---:|---:|---:|---|

## 11. やらない方がいい買い方
- 常時 `top3_box` / `top4_box`: 的中率は上がりやすいが、点数増でROIが落ちる場合は危険。
- odds欠損率が高いstrategy: 結果オッズを取れたticketだけの参考値になる。
- `first_fixed_second_third_flow` の常用: 最大20点で、的中率上昇より投資増が勝ちやすい。
- 高配当1発で最大1hit除外ROIが崩れる条件: 偽edge疑い。

## 12. 過学習リスク
| strategy | train ROI | validation ROI | test ROI | 月別安定性 | 判定 |
|---|---:|---:|---:|---|---|
| original_single | 78.05% | 83.76% | 89.90% | 7/23ヶ月がROI>=100、11ヶ月がROI<80 | C: 観察 |
| first_second_third_flow | 78.34% | 83.07% | 89.05% | 6/23ヶ月がROI>=100、11ヶ月がROI<80 | C: 観察 |
| first_third_second_flow | 78.05% | 83.76% | 89.90% | 7/23ヶ月がROI>=100、11ヶ月がROI<80 | C: 観察 |
| first_fixed_second_third_flow | 79.28% | 86.06% | 78.93% | 4/23ヶ月がROI>=100、12ヶ月がROI<80 | C: 観察 |
| top3_box | 79.19% | 87.00% | 81.21% | 4/23ヶ月がROI>=100、10ヶ月がROI<80 | C: 観察 |
| top4_box | 80.29% | 88.20% | 79.94% | 5/23ヶ月がROI>=100、10ヶ月がROI<80 | C: 観察 |
| second_third_reverse | 79.19% | 87.00% | 81.21% | 4/23ヶ月がROI>=100、10ヶ月がROI<80 | C: 観察 |
| first_second_flow_odds_min_5 | 78.34% | 83.07% | 89.05% | 6/23ヶ月がROI>=100、11ヶ月がROI<80 | C: 観察 |
| first_second_flow_odds_min_8 | 78.34% | 83.07% | 89.05% | 6/23ヶ月がROI>=100、11ヶ月がROI<80 | C: 観察 |
| first_second_flow_odds_min_10 | 78.34% | 83.07% | 89.05% | 6/23ヶ月がROI>=100、11ヶ月がROI<80 | C: 観察 |
| box_only_when_order_uncertain | 78.79% | 87.19% | 81.21% | 5/23ヶ月がROI>=100、10ヶ月がROI<80 | C: 観察 |

## 13. 次に実装するならこの順番
1. 本番変更ではなく、paper検証で `second_third_reverse` と `first_second_third_flow` を比較する。
2. `1着2着は合っていて3着違い` が多い会場だけ `1-2-流し` を検証する。
3. `selectionの3艇は全部入っていたが順番違い` が多い条件だけ `top3_box` を検証する。
4. 常時BOX/常時20点流しは避け、NO BUY条件とセットで検証する。
5. odds鮮度と欠損率をstrategy評価に加え、締切直前oddsで再評価する。

## 14. 中学生でも分かる説明
1点買いは、当たると大きいけれど外れやすい作戦です。流しやBOXは当たりやすくなりますが、買う点数が増えるので、お金もたくさん使います。だから「当たる回数が増えた」だけでは良くなくて、「増えた投資より回収が増えたか」を見ます。今回の分析は、どんな時だけ広げる価値があるか、逆に広げても損しやすいかを調べるものです。

## 追加提案
| 優先度 | 提案 | 理由 | 期待効果 | リスク | 今回やる/次回やる |
|---|---|---|---|---|---|
| S | 流し/BOXの前にNO BUY条件を重ねる | 点数を増やすと投資が増える | 不要BUY削減とstrategy改善を両立 | 削りすぎ | 今回レポートで提案、実装は次回paper |
| S | odds鮮度をstrategy評価に入れる | 仮想ticketのoddsが古いとROIが歪む | 偽edge削減 | 時系列欠損 | 次回やる |
| A | 2着3着逆転専用の条件付き保険 | 常時保険はROIを落としやすい | 惜しい外れだけ拾う | 過学習 | 次回やる |
| A | 会場別にstrategyを分ける | 流しが効く水面と効かない水面が違う | 汎用ルールの粗さを減らす | n不足 | 次回やる |
| B | 人気順/1-2-3固定ベースライン比較 | モデルstrategyが単純ベースラインに勝つ必要がある | モデル価値の確認 | odds取得範囲依存 | 次回やる |
| B | UIに買わない理由とstrategy非採用理由を表示 | BUYが購入指示に見える誤解を避ける | 安全性と説明性向上 | UI文言調整 | 次回やる |
| C | 選手役割で展開シナリオを保存 | 強さより逃げ/差し/まくりの噛み合わせが重要 | BOX条件の精度向上 | 分類過学習 | 次回以降 |

