# 能力情報×市場順位 三段階ROI検証

> discovery→validationを通過した条件だけを2025 testで判定する。closing oddsであり本番採用不可。

coverage: 候補4184 / 評価4136 / 除外48レース
探索族: 9戦略 / 206条件
split: 2024上期 discovery / 2024下期 validation / 2025 untouched test

## Gate通過数

- discovery通過: 20
- validationまで通過: 1
- test頑健利益gate通過: 0

## validation通過候補のtest結果

| 戦略 | 条件 | discovery | validation | test | test LOO最小 | 判定 |
|---|---|---:|---:|---:|---:|---|
| 展示最速 | market rank 3 | n=194 / edge +5.35pt / ROI 147.4% / max2 118.4% | n=277 / edge +2.27pt / ROI 112.5% / max2 96.8% | n=246 / edge +0.12pt / ROI 77.7% / max2 55.6% | 41.3% | reject |

## validationで落ちた上位候補

| 戦略 | 条件 | discovery | validation |
|---|---|---:|---:|
| 1-X市場最人気 | course 6 | n=93 / edge +6.09pt / ROI 131.1% / max2 103.8% | n=106 / edge +7.09pt / ROI 99.9% / max2 87.8% |
| 展示最速 | wind 6plus | n=73 / edge +6.62pt / ROI 132.3% / max2 98.9% | n=61 / edge +3.59pt / ROI 128.7% / max2 71.5% |
| 4指標合議 | market rank 3 | n=135 / edge +6.75pt / ROI 129.0% / max2 99.2% | n=182 / edge +2.03pt / ROI 96.5% / max2 72.3% |
| 能力順位より市場人気が低い艇 | market rank 3 | n=280 / edge +4.88pt / ROI 131.2% / max2 115.1% | n=321 / edge +1.76pt / ROI 92.2% / max2 81.2% |
| 能力順位より市場人気が低い艇 | odds under10 | n=217 / edge +6.57pt / ROI 130.2% / max2 122.2% | n=329 / edge +1.68pt / ROI 82.7% / max2 77.2% |
| 展示最速 | wind 1 2 | n=172 / edge +6.11pt / ROI 126.0% / max2 95.9% | n=270 / edge +1.97pt / ROI 83.3% / max2 63.4% |
| 能力順位より市場人気が低い艇 | wind 3 4 | n=295 / edge +2.50pt / ROI 114.8% / max2 88.0% | n=369 / edge +1.37pt / ROI 86.3% / max2 69.2% |
| 全国勝率最上位 | race 9 12 | n=99 / edge +7.33pt / ROI 102.4% / max2 85.9% | n=119 / edge +2.77pt / ROI 68.6% / max2 55.6% |
| 当地勝率最上位 | market rank 3 | n=152 / edge +7.13pt / ROI 131.0% / max2 101.9% | n=198 / edge +0.44pt / ROI 85.6% / max2 66.2% |
| 当地勝率最上位 | course 6 | n=308 / edge +4.74pt / ROI 135.5% / max2 106.8% | n=371 / edge +1.47pt / ROI 76.3% / max2 59.3% |
| 4指標合議 | course 6 | n=238 / edge +5.19pt / ROI 126.0% / max2 104.1% | n=319 / edge +1.63pt / ROI 69.8% / max2 54.8% |
| 全国勝率最上位 | course 6 | n=325 / edge +2.84pt / ROI 104.8% / max2 88.3% | n=378 / edge +1.33pt / ROI 68.5% / max2 58.2% |
| 能力順位より市場人気が低い艇 | course 3 | n=69 / edge +5.92pt / ROI 137.2% / max2 85.4% | n=64 / edge +0.58pt / ROI 79.4% / max2 34.5% |
| 4指標合議 | underbought gap 2plus | n=159 / edge +6.46pt / ROI 139.5% / max2 106.8% | n=215 / edge +0.16pt / ROI 67.8% / max2 39.6% |
| モーター2連率最上位 | odds 10 20 | n=313 / edge +3.82pt / ROI 126.5% / max2 115.0% | n=411 / edge -1.01pt / ROI 65.8% / max2 56.5% |

## placebo

- 全国勝率最低_placebo: discovery n=1148 / edge -0.96pt / ROI 52.8% / max2 40.4% / validation n=1532 / edge -0.03pt / ROI 66.2% / max2 53.2% / test n=1456 / edge -0.12pt / ROI 57.5% / max2 44.9%

## 結論

能力情報と市場順位のずれを組み合わせても、三段階で頑健に黒字化するedgeは確認できなかった。

- 2025 testを見て条件や閾値を変更しない。
- BUY・app_settings・本番decisionへ接続しない。
