# no buy next candidates

baseline: n=6260 hit=124 ROI=0.804

| rank | NO BUY条件 | 削除BUY数 | 削除BUY ROI | 残りBUY数 | 残りROI | train/test安定性 | 推奨 |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | F持ち複数レース | 4029 | 0.747 | 2231 | 0.905 | train=0.823 validation=0.490 test=0.737 badMonths=14/23 | A: 追加確認 |
| 2 | venueMotorTop2Rate 35-50 | 2247 | 0.713 | 4013 | 0.855 | train=0.641 validation=0.876 test=0.889 badMonths=10/22 | A: 追加確認 |
| 3 | 会場=戸田 | 319 | 0.164 | 5941 | 0.838 | train=0.234 validation=0.000 test=0.000 badMonths=5/5 | S: paper NO BUY検証 |
| 4 | 11R | 192 | 0.000 | 6068 | 0.829 | train=0.000 validation=0.000 test=0.000 badMonths=1/1 | S: paper NO BUY検証 |
| 5 | 会場=多摩川 | 282 | 0.288 | 5978 | 0.828 | train=0.000 validation=1.450 test=0.000 badMonths=3/3 | A: 追加確認 |
| 6 | 10R | 340 | 0.424 | 5920 | 0.826 | train=0.372 validation=0.000 test=1.647 badMonths=4/6 | A: 追加確認 |
| 7 | 会場=桐生 | 307 | 0.414 | 5953 | 0.824 | train=0.594 validation=0.000 test=0.000 badMonths=2/4 | S: paper NO BUY検証 |
| 8 | odds >= 50 | 1800 | 0.768 | 4460 | 0.818 | train=0.635 validation=1.478 test=0.284 badMonths=11/21 | A: 追加確認 |
| 9 | 会場=三国 | 276 | 0.499 | 5984 | 0.818 | train=0.567 validation=0.515 test=0.000 badMonths=2/4 | S: paper NO BUY検証 |
| 10 | wave >= 5 | 755 | 0.704 | 5505 | 0.817 | train=0.864 validation=0.270 test=0.450 badMonths=9/17 | A: 追加確認 |
| 11 | venueMotorTop2Rate >= 50 | 143 | 0.299 | 6117 | 0.816 | train=0.428 validation=0.000 test=0.000 badMonths=2/2 | S: paper NO BUY検証 |
| 12 | 12R | 89 | 0.000 | 6171 | 0.815 | train=0.000 validation=0.000 test=0.000 badMonths=0/0 | S: paper NO BUY検証 |
| 13 | 会場=江戸川 | 186 | 0.541 | 6074 | 0.812 | train=0.462 validation=1.100 test=0.000 badMonths=0/0 | A: 追加確認 |
| 14 | 会場=住之江 | 225 | 0.600 | 6035 | 0.811 | train=0.860 validation=0.000 test=0.000 badMonths=1/1 | S: paper NO BUY検証 |
| 15 | 会場=福岡 | 260 | 0.680 | 6000 | 0.809 | train=0.336 validation=2.225 test=0.000 badMonths=4/4 | A: 追加確認 |
| 16 | 会場=徳山 | 242 | 0.671 | 6018 | 0.809 | train=0.560 validation=0.490 test=1.772 badMonths=2/3 | S: paper NO BUY検証 |
| 17 | 頭展示4位以下 | 2389 | 0.797 | 3871 | 0.808 | train=0.768 validation=0.723 test=1.148 badMonths=11/22 | A: 追加確認 |
| 18 | 会場=浜名湖 | 283 | 0.716 | 5977 | 0.808 | train=1.024 validation=0.000 test=0.000 badMonths=1/3 | A: 追加確認 |
| 19 | 会場=下関 | 241 | 0.729 | 6019 | 0.807 | train=1.046 validation=0.000 test=0.000 badMonths=2/3 | A: 追加確認 |
| 20 | wind >= 8 | 123 | 0.673 | 6137 | 0.806 | train=0.963 validation=0.000 test=0.000 badMonths=0/0 | A: 追加確認 |
| 21 | 会場=蒲郡 | 330 | 0.775 | 5930 | 0.805 | train=0.395 validation=1.760 test=1.424 badMonths=7/9 | A: 追加確認 |
| 22 | 会場=鳴門 | 202 | 0.760 | 6058 | 0.805 | train=1.089 validation=0.000 test=0.000 badMonths=1/1 | A: 追加確認 |
| 23 | motor情報fallback/missing | 47 | 0.700 | 6213 | 0.805 | train=0.522 validation=0.000 test=3.240 badMonths=1/1 | C: n不足 |
| 24 | 会場=尼崎 | 216 | 0.786 | 6044 | 0.804 | train=1.125 validation=0.000 test=0.000 badMonths=2/2 | A: 追加確認 |
| 25 | 会場=丸亀 | 223 | 0.821 | 6037 | 0.803 | train=0.737 validation=0.857 test=1.317 badMonths=2/2 | D: 残りROI改善なし |
| 26 | 会場=若松 | 292 | 0.821 | 5968 | 0.803 | train=0.764 validation=0.871 test=1.110 badMonths=3/4 | D: 残りROI改善なし |
| 27 | 会場=宮島 | 277 | 0.847 | 5983 | 0.802 | train=0.589 validation=1.039 test=2.243 badMonths=4/5 | D: 残りROI改善なし |
| 28 | 会場=大村 | 256 | 0.874 | 6004 | 0.801 | train=0.599 validation=1.612 test=1.315 badMonths=1/2 | D: 残りROI改善なし |
| 29 | 会場=唐津 | 289 | 0.976 | 5971 | 0.795 | train=0.929 validation=1.040 test=1.179 badMonths=0/3 | D: 残りROI改善なし |
| 30 | 会場=津 | 242 | 1.047 | 6018 | 0.794 | train=1.343 validation=0.000 test=1.056 badMonths=2/3 | D: 残りROI改善なし |
| 31 | wind >= 5 | 1023 | 0.866 | 5237 | 0.792 | train=0.938 validation=0.731 test=0.631 badMonths=11/20 | D: 残りROI改善なし |
| 32 | 会場=平和島 | 261 | 1.140 | 5999 | 0.789 | train=0.927 validation=1.494 test=1.893 badMonths=2/3 | D: 残りROI改善なし |
| 33 | 会場=びわこ | 284 | 1.119 | 5976 | 0.789 | train=0.621 validation=2.177 test=2.438 badMonths=2/5 | D: 残りROI改善なし |
| 34 | 部品交換あり | 822 | 0.911 | 5438 | 0.788 | train=0.727 validation=1.657 test=0.712 badMonths=9/22 | D: 残りROI改善なし |
| 35 | 会場=常滑 | 324 | 1.217 | 5936 | 0.781 | train=1.435 validation=0.643 test=0.855 badMonths=3/5 | D: 残りROI改善なし |
| 36 | 会場=芦屋 | 219 | 1.473 | 6041 | 0.780 | train=1.323 validation=1.800 test=1.864 badMonths=1/2 | D: 残りROI改善なし |
| 37 | 会場=児島 | 224 | 1.571 | 6036 | 0.775 | train=1.928 validation=1.140 test=0.000 badMonths=1/3 | D: 残りROI改善なし |
| 38 | venueMotorTop2Rate < 35 | 3823 | 0.877 | 2437 | 0.688 | train=0.866 validation=0.911 test=0.892 badMonths=8/22 | D: 残りROI改善なし |

## 注意
- これはedge候補であり、本物のedgeではありません。
- n<50、最大1hit依存、test逆行の条件は本番採用しません。
