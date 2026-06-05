# bet strategy odds coverage review

## mode定義
- strict: 必要ticketのoddsが1つでも欠損したraceは評価から除外
- conservative: 欠損ticketも投資した扱い。的中してもodds不明なら回収0
- available-only: oddsがあるticketだけ買った扱い。参考値で採用判断には使わない

| strategy | mode | races | total_tickets | missing_rate | hit_rate | ROI | 判定 |
|---|---|---:|---:|---:|---:|---:|---|
| original_single | available-only | 6260 | 6260 | 0.00% | 1.98% | 0.804 | 参考値。採用判断に使わない |
| original_single | strict | 6260 | 6260 | 0.00% | 1.98% | 0.804 | 採用不可 |
| original_single | conservative | 6260 | 6260 | 0.00% | 1.98% | 0.804 | 採用不可 |
| second_third_reverse | available-only | 6260 | 6720 | 46.33% | 2.14% | 0.810 | 参考値。採用判断に使わない |
| second_third_reverse | strict | 460 | 920 | 0.00% | 5.22% | 1.115 | paper検証候補 |
| second_third_reverse | conservative | 6260 | 12520 | 46.33% | 2.14% | 0.435 | 欠損過多。本番採用不可 |
| first_second_third_flow | available-only | 6260 | 6450 | 74.24% | 2.03% | 0.803 | 参考値。採用判断に使わない |
| first_second_third_flow | strict | 0 | 0 | 0.00% | 0.00% | 0.000 | 採用不可 |
| first_second_third_flow | conservative | 6260 | 25040 | 74.24% | 2.03% | 0.207 | 欠損過多。本番採用不可 |
| first_fixed_second_third_flow | available-only | 6260 | 7000 | 94.41% | 2.20% | 0.806 | 参考値。採用判断に使わない |
| first_fixed_second_third_flow | strict | 0 | 0 | 0.00% | 0.00% | 0.000 | 採用不可 |
| first_fixed_second_third_flow | conservative | 6260 | 125200 | 94.41% | 2.20% | 0.045 | 欠損過多。本番採用不可 |
| top3_box | available-only | 6260 | 6720 | 82.11% | 2.14% | 0.810 | 参考値。採用判断に使わない |
| top3_box | strict | 0 | 0 | 0.00% | 0.00% | 0.000 | 採用不可 |
| top3_box | conservative | 6260 | 37560 | 82.11% | 2.14% | 0.145 | 欠損過多。本番採用不可 |
| top4_box | available-only | 6260 | 6832 | 95.45% | 2.19% | 0.819 | 参考値。採用判断に使わない |
| top4_box | strict | 0 | 0 | 0.00% | 0.00% | 0.000 | 採用不可 |
| top4_box | conservative | 6260 | 150240 | 95.45% | 2.19% | 0.037 | 欠損過多。本番採用不可 |
| box_only_when_order_uncertain | available-only | 6260 | 6708 | 80.91% | 2.12% | 0.808 | 参考値。採用判断に使わない |
| box_only_when_order_uncertain | strict | 486 | 486 | 0.00% | 2.67% | 0.693 | 採用不可 |
| box_only_when_order_uncertain | conservative | 6260 | 35130 | 80.91% | 2.12% | 0.154 | 欠損過多。本番採用不可 |

## 結論
- available-onlyで微改善しても、strict/conservativeで崩れるなら本番採用不可。
- odds_snapshotsが全120点を保持していない限り、BOX/流しのROI評価は過大評価される可能性があります。
