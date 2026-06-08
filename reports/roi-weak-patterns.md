# ROI Weak Patterns Analysis

生成: 2026-06-08T05:57:10.108Z / DB: data/boat.sqlite

対象: historical-backfill BUY n=6260

baseline ROI: 80.38% (n=6260 / hits=124)


## サマリー

全体baseline ROI: 80.38% (n=6260)
NO_BUY_CANDIDATE: 14件
PAPER_ONLY: 9件
DO_NOT_TOUCH: 4件
WATCH: 5件

主要な弱条件:
  ⛔ odds>=80 (一発依存): ROI=0.00%
  ⛔ レースNo10-12: ROI=23.20%
  ⛔ 会場: 戸田: ROI=16.36%
  ⛔ 会場: 多摩川: ROI=28.79%
  ❌ 月2: ROI=35.17%
  ❌ 月3: ROI=58.77%
  ❌ 月7: ROI=66.98%
  ❌ 月9: ROI=67.32%
  ❌ partsあり (parts>=1): ROI=67.81%
  ❌ parts欠損 (equipmentなし): ROI=63.27%
  ❌ headFあり (flyingCount>=1): ROI=59.78%
  ❌ 会場: 桐生: ROI=41.40%
  ❌ 会場: 三国: ROI=49.89%
  ❌ 会場: 江戸川: ROI=54.14%
  ❌ 会場: 住之江: ROI=60.00%
  ❌ 会場: 徳山: ROI=67.11%
  ❌ 会場: 福岡: ROI=68.00%
  ❌ headFあり×強月: ROI=67.66%

## ⛔ DO_NOT_TOUCH

| 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | 警告 |
|---|---:|---:|---:|---:|---:|---:|---|
| odds>=80 (一発依存) | 92 | 0 | 0.00% | 0.00% | 0.00% | 0.00 | ⛔ ROI0.00% — 基準比80.38pp低下 |
| レースNo10-12 | 621 | 4 | 0.64% | 23.20% | 15.59% | 47.30 | DO_NOT_TOUCH: ROI=23.20% |
| 会場: 戸田 | 319 | 1 | 0.31% | 16.36% | 0.00% | 52.20 | DO_NOT_TOUCH: ROI=16.36% |
| 会場: 多摩川 | 282 | 2 | 0.71% | 28.79% | 14.29% | 40.90 | DO_NOT_TOUCH: ROI=28.79% |

## ❌ NO_BUY_CANDIDATE

| 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | 警告 |
|---|---:|---:|---:|---:|---:|---:|---|
| 月2 | 385 | 3 | 0.78% | 35.17% | 21.61% | 52.20 | ❌ ROI低: NO_BUY_CANDIDATE |
| 月3 | 465 | 5 | 1.08% | 58.77% | 42.34% | 76.40 | ❌ ROI低: NO_BUY_CANDIDATE |
| 月7 | 693 | 11 | 1.59% | 66.98% | 57.98% | 62.40 | ❌ ROI低: NO_BUY_CANDIDATE |
| 月9 | 533 | 10 | 1.88% | 67.32% | 58.44% | 47.30 | ❌ ROI低: NO_BUY_CANDIDATE |
| partsあり (parts>=1) | 269 | 5 | 1.86% | 67.81% | 48.29% | 52.50 | ❌ ROI67.81% — NO_BUY推奨 |
| parts欠損 (equipmentなし) | 52 | 2 | 3.85% | 63.27% | 31.15% | 16.70 | ❌ ROI63.27% — NO_BUY推奨 |
| headFあり (flyingCount>=1) | 1938 | 29 | 1.50% | 59.78% | 55.84% | 76.40 | ❌ ROI59.78% — NO_BUY推奨 |
| 会場: 桐生 | 307 | 3 | 0.98% | 41.40% | 24.76% | 51.10 | NO_BUY_CANDIDATE: ROI=41.40% |
| 会場: 三国 | 276 | 4 | 1.45% | 49.89% | 34.38% | 42.80 | NO_BUY_CANDIDATE: ROI=49.89% |
| 会場: 江戸川 | 186 | 2 | 1.08% | 54.14% | 21.88% | 60.00 | NO_BUY_CANDIDATE: ROI=54.14% |
| 会場: 住之江 | 225 | 4 | 1.78% | 60.00% | 42.80% | 38.70 | NO_BUY_CANDIDATE: ROI=60.00% |
| 会場: 徳山 | 242 | 5 | 2.07% | 67.11% | 48.80% | 44.30 | NO_BUY_CANDIDATE: ROI=67.11% |
| 会場: 福岡 | 260 | 5 | 1.92% | 68.00% | 47.81% | 52.50 | NO_BUY_CANDIDATE: ROI=68.00% |
| headFあり×強月 | 693 | 11 | 1.59% | 67.66% | 59.00% | 60.00 | ❌ ROI67.66% — NO_BUY推奨 |

## ⚠️ PAPER_ONLY

| 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | 警告 |
|---|---:|---:|---:|---:|---:|---:|---|
| 月1 | 275 | 4 | 1.45% | 72.44% | 49.78% | 62.30 | ⚠️ PAPER_ONLY |
| 月5 | 702 | 16 | 2.28% | 83.65% | 75.77% | 55.30 | ⚠️ PAPER_ONLY |
| 月10 | 494 | 9 | 1.82% | 76.54% | 65.34% | 55.30 | ⚠️ PAPER_ONLY |
| 月11 | 559 | 12 | 2.15% | 83.79% | 74.65% | 51.10 | ⚠️ PAPER_ONLY |
| exSt危険帯 (0.10-0.15) | 1035 | 20 | 1.93% | 71.93% | 66.59% | 55.30 | ⚠️ ROI71.93% — PAPER_ONLYで様子見 |
| wind<3 (弱風) | 2800 | 52 | 1.86% | 73.85% | 71.12% | 76.40 | ⚠️ ROI73.85% — PAPER_ONLYで様子見 |
| レースNo1-3 | 1605 | 35 | 2.18% | 86.49% | 81.65% | 77.70 | PAPER_ONLY: ROI=86.49% |
| レースNo4-6 | 2250 | 43 | 1.91% | 77.99% | 75.20% | 62.60 | PAPER_ONLY: ROI=77.99% |
| partsあり×強月 | 80 | 2 | 2.50% | 100.00% | 34.38% | 52.50 | ⚠️ ROI100.00% — PAPER_ONLYで様子見 |

## △ WATCH

| 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | 警告 |
|---|---:|---:|---:|---:|---:|---:|---|
| 月4 | 485 | 10 | 2.06% | 102.41% | 86.39% | 77.70 | ⚠️ WATCH |
| 月6 | 590 | 13 | 2.20% | 91.92% | 81.31% | 62.60 | ⚠️ WATCH |
| 月12 | 378 | 11 | 2.91% | 92.78% | 81.14% | 44.00 | ⚠️ WATCH |
| レースNo7-9 | 1784 | 42 | 2.35% | 97.79% | 93.51% | 76.40 | WATCH: ROI=97.79% |
| odds>=80×isBase条件 | 3 | 0 | 0.00% | 0.00% | 0.00% | 0.00 | △ ROI0.00% — 観察中 |

## 全パターン詳細

| 分類 | 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | avgOdds |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ⚠️ PAPER_ONLY | 月1 | 275 | 4 | 1.45% | 72.44% | 49.78% | 62.30 | 55.16 |
| ❌ NO_BUY_CANDIDATE | 月2 | 385 | 3 | 0.78% | 35.17% | 21.61% | 52.20 | 52.61 |
| ❌ NO_BUY_CANDIDATE | 月3 | 465 | 5 | 1.08% | 58.77% | 42.34% | 76.40 | 51.08 |
| △ WATCH | 月4 | 485 | 10 | 2.06% | 102.41% | 86.39% | 77.70 | 47.34 |
| ⚠️ PAPER_ONLY | 月5 | 702 | 16 | 2.28% | 83.65% | 75.77% | 55.30 | 45.89 |
| △ WATCH | 月6 | 590 | 13 | 2.20% | 91.92% | 81.31% | 62.60 | 43.17 |
| ❌ NO_BUY_CANDIDATE | 月7 | 693 | 11 | 1.59% | 66.98% | 57.98% | 62.40 | 42.07 |
| ❌ NO_BUY_CANDIDATE | 月9 | 533 | 10 | 1.88% | 67.32% | 58.44% | 47.30 | 39.53 |
| ⚠️ PAPER_ONLY | 月10 | 494 | 9 | 1.82% | 76.54% | 65.34% | 55.30 | 41.19 |
| ⚠️ PAPER_ONLY | 月11 | 559 | 12 | 2.15% | 83.79% | 74.65% | 51.10 | 40.40 |
| △ WATCH | 月12 | 378 | 11 | 2.91% | 92.78% | 81.14% | 44.00 | 38.74 |
| ❌ NO_BUY_CANDIDATE | partsあり (parts>=1) | 269 | 5 | 1.86% | 67.81% | 48.29% | 52.50 | 45.53 |
| ❌ NO_BUY_CANDIDATE | parts欠損 (equipmentなし) | 52 | 2 | 3.85% | 63.27% | 31.15% | 16.70 | 38.11 |
| ❌ NO_BUY_CANDIDATE | headFあり (flyingCount>=1) | 1938 | 29 | 1.50% | 59.78% | 55.84% | 76.40 | 44.11 |
| ⚠️ PAPER_ONLY | exSt危険帯 (0.10-0.15) | 1035 | 20 | 1.93% | 71.93% | 66.59% | 55.30 | 44.15 |
| ⚠️ PAPER_ONLY | wind<3 (弱風) | 2800 | 52 | 1.86% | 73.85% | 71.12% | 76.40 | 43.94 |
| ⛔ DO_NOT_TOUCH | odds>=80 (一発依存) | 92 | 0 | 0.00% | 0.00% | 0.00% | 0.00 | 87.23 |
| ⚠️ PAPER_ONLY | レースNo1-3 | 1605 | 35 | 2.18% | 86.49% | 81.65% | 77.70 | 45.70 |
| ⚠️ PAPER_ONLY | レースNo4-6 | 2250 | 43 | 1.91% | 77.99% | 75.20% | 62.60 | 44.85 |
| △ WATCH | レースNo7-9 | 1784 | 42 | 2.35% | 97.79% | 93.51% | 76.40 | 43.96 |
| ⛔ DO_NOT_TOUCH | レースNo10-12 | 621 | 4 | 0.64% | 23.20% | 15.59% | 47.30 | 40.10 |
| ⛔ DO_NOT_TOUCH | 会場: 戸田 | 319 | 1 | 0.31% | 16.36% | 0.00% | 52.20 | 61.04 |
| ⛔ DO_NOT_TOUCH | 会場: 多摩川 | 282 | 2 | 0.71% | 28.79% | 14.29% | 40.90 | 44.02 |
| ❌ NO_BUY_CANDIDATE | 会場: 桐生 | 307 | 3 | 0.98% | 41.40% | 24.76% | 51.10 | 43.67 |
| ❌ NO_BUY_CANDIDATE | 会場: 三国 | 276 | 4 | 1.45% | 49.89% | 34.38% | 42.80 | 40.78 |
| ❌ NO_BUY_CANDIDATE | 会場: 江戸川 | 186 | 2 | 1.08% | 54.14% | 21.88% | 60.00 | 50.22 |
| ❌ NO_BUY_CANDIDATE | 会場: 住之江 | 225 | 4 | 1.78% | 60.00% | 42.80% | 38.70 | 41.10 |
| ❌ NO_BUY_CANDIDATE | 会場: 徳山 | 242 | 5 | 2.07% | 67.11% | 48.80% | 44.30 | 31.54 |
| ❌ NO_BUY_CANDIDATE | 会場: 福岡 | 260 | 5 | 1.92% | 68.00% | 47.81% | 52.50 | 36.12 |
| ⚠️ PAPER_ONLY | partsあり×強月 | 80 | 2 | 2.50% | 100.00% | 34.38% | 52.50 | 42.47 |
| ❌ NO_BUY_CANDIDATE | headFあり×強月 | 693 | 11 | 1.59% | 67.66% | 59.00% | 60.00 | 43.38 |
| △ WATCH | odds>=80×isBase条件 | 3 | 0 | 0.00% | 0.00% | 0.00% | 0.00 | 89.60 |

## 各条件の解説

### 月1 — PAPER_ONLY

**条件**: `month=1`

**解説**: 月1のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ PAPER_ONLY

n=275 / ROI=72.44% / roiExMaxHit=49.78% / maxHitOdds=62.30


### 月2 — NO_BUY_CANDIDATE

**条件**: `month=2`

**解説**: 月2のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ❌ ROI低: NO_BUY_CANDIDATE

n=385 / ROI=35.17% / roiExMaxHit=21.61% / maxHitOdds=52.20


### 月3 — NO_BUY_CANDIDATE

**条件**: `month=3`

**解説**: 月3のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ❌ ROI低: NO_BUY_CANDIDATE

n=465 / ROI=58.77% / roiExMaxHit=42.34% / maxHitOdds=76.40


### 月4 — WATCH

**条件**: `month=4`

**解説**: 月4のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ WATCH

n=485 / ROI=102.41% / roiExMaxHit=86.39% / maxHitOdds=77.70


### 月5 — PAPER_ONLY

**条件**: `month=5`

**解説**: 月5のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ PAPER_ONLY

n=702 / ROI=83.65% / roiExMaxHit=75.77% / maxHitOdds=55.30


### 月6 — WATCH

**条件**: `month=6`

**解説**: 月6のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ WATCH

n=590 / ROI=91.92% / roiExMaxHit=81.31% / maxHitOdds=62.60


### 月7 — NO_BUY_CANDIDATE

**条件**: `month=7`

**解説**: 月7のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ❌ ROI低: NO_BUY_CANDIDATE

n=693 / ROI=66.98% / roiExMaxHit=57.98% / maxHitOdds=62.40


### 月9 — NO_BUY_CANDIDATE

**条件**: `month=9`

**解説**: 月9のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ❌ ROI低: NO_BUY_CANDIDATE

n=533 / ROI=67.32% / roiExMaxHit=58.44% / maxHitOdds=47.30


### 月10 — PAPER_ONLY

**条件**: `month=10`

**解説**: 月10のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ PAPER_ONLY

n=494 / ROI=76.54% / roiExMaxHit=65.34% / maxHitOdds=55.30


### 月11 — PAPER_ONLY

**条件**: `month=11`

**解説**: 月11のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ PAPER_ONLY

n=559 / ROI=83.79% / roiExMaxHit=74.65% / maxHitOdds=51.10


### 月12 — WATCH

**条件**: `month=12`

**解説**: 月12のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。

**警告**: ⚠️ WATCH

n=378 / ROI=92.78% / roiExMaxHit=81.14% / maxHitOdds=44.00


### partsあり (parts>=1) — NO_BUY_CANDIDATE

**条件**: `parts_changed_count>=1`

**解説**: 部品交換あり。機力評価にノイズが入り予測安定性が下がる可能性。特に強月でも除外検討。

**警告**: ❌ ROI67.81% — NO_BUY推奨

n=269 / ROI=67.81% / roiExMaxHit=48.29% / maxHitOdds=52.50


### parts欠損 (equipmentなし) — NO_BUY_CANDIDATE

**条件**: `parts_changed_count IS NULL`

**解説**: parts情報が取得できていない。isBase条件の信頼性低下。欠損率が高い月は条件全体の有効性に注意。

**警告**: ❌ ROI63.27% — NO_BUY推奨

n=52 / ROI=63.27% / roiExMaxHit=31.15% / maxHitOdds=16.70


### headFあり (flyingCount>=1) — NO_BUY_CANDIDATE

**条件**: `head_flying_count>=1`

**解説**: 頭艇にF歴あり。スタートリスクが上がり、1艇固定ロジックの前提が崩れやすい。

**警告**: ❌ ROI59.78% — NO_BUY推奨

n=1938 / ROI=59.78% / roiExMaxHit=55.84% / maxHitOdds=76.40


### exSt危険帯 (0.10-0.15) — PAPER_ONLY

**条件**: `head_ex_st BETWEEN 0.10 AND 0.149`

**解説**: 展示ST 0.10-0.15の帯域。スタート踏み込みが曖昧で再現性が低い。isBase条件では除外対象。

**警告**: ⚠️ ROI71.93% — PAPER_ONLYで様子見

n=1035 / ROI=71.93% / roiExMaxHit=66.59% / maxHitOdds=55.30


### wind<3 (弱風) — PAPER_ONLY

**条件**: `wind_speed_mps<3 (OR NULL)`

**解説**: 風速3m/s未満。強風による市場歪みが発生しにくく、odds帯の優位性が出にくい可能性。

**警告**: ⚠️ ROI73.85% — PAPER_ONLYで様子見

n=2800 / ROI=73.85% / roiExMaxHit=71.12% / maxHitOdds=76.40


### odds>=80 (一発依存) — DO_NOT_TOUCH

**条件**: `current_odds>=80`

**解説**: 高配当一発依存。roiExMaxHitで崩れる場合、実運用では資金リスクが高い。基本はDO_NOT_TOUCH推奨。

**警告**: ⛔ ROI0.00% — 基準比80.38pp低下

n=92 / ROI=0.00% / roiExMaxHit=0.00% / maxHitOdds=0.00


### レースNo1-3 — PAPER_ONLY

**条件**: `race_no IN (1,2,3)`

**解説**: レースNo1-3のROI。後半レースは番組差が出やすい。

**警告**: PAPER_ONLY: ROI=86.49%

n=1605 / ROI=86.49% / roiExMaxHit=81.65% / maxHitOdds=77.70


### レースNo4-6 — PAPER_ONLY

**条件**: `race_no IN (4,5,6)`

**解説**: レースNo4-6のROI。後半レースは番組差が出やすい。

**警告**: PAPER_ONLY: ROI=77.99%

n=2250 / ROI=77.99% / roiExMaxHit=75.20% / maxHitOdds=62.60


### レースNo7-9 — WATCH

**条件**: `race_no IN (7,8,9)`

**解説**: レースNo7-9のROI。後半レースは番組差が出やすい。

**警告**: WATCH: ROI=97.79%

n=1784 / ROI=97.79% / roiExMaxHit=93.51% / maxHitOdds=76.40


### レースNo10-12 — DO_NOT_TOUCH

**条件**: `race_no IN (10,11,12)`

**解説**: レースNo10-12のROI。後半レースは番組差が出やすい。

**警告**: DO_NOT_TOUCH: ROI=23.20%

n=621 / ROI=23.20% / roiExMaxHit=15.59% / maxHitOdds=47.30


### 会場: 戸田 — DO_NOT_TOUCH

**条件**: `venue='戸田'`

**解説**: 会場戸田のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: DO_NOT_TOUCH: ROI=16.36%

n=319 / ROI=16.36% / roiExMaxHit=0.00% / maxHitOdds=52.20


### 会場: 多摩川 — DO_NOT_TOUCH

**条件**: `venue='多摩川'`

**解説**: 会場多摩川のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: DO_NOT_TOUCH: ROI=28.79%

n=282 / ROI=28.79% / roiExMaxHit=14.29% / maxHitOdds=40.90


### 会場: 桐生 — NO_BUY_CANDIDATE

**条件**: `venue='桐生'`

**解説**: 会場桐生のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: NO_BUY_CANDIDATE: ROI=41.40%

n=307 / ROI=41.40% / roiExMaxHit=24.76% / maxHitOdds=51.10


### 会場: 三国 — NO_BUY_CANDIDATE

**条件**: `venue='三国'`

**解説**: 会場三国のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: NO_BUY_CANDIDATE: ROI=49.89%

n=276 / ROI=49.89% / roiExMaxHit=34.38% / maxHitOdds=42.80


### 会場: 江戸川 — NO_BUY_CANDIDATE

**条件**: `venue='江戸川'`

**解説**: 会場江戸川のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: NO_BUY_CANDIDATE: ROI=54.14%

n=186 / ROI=54.14% / roiExMaxHit=21.88% / maxHitOdds=60.00


### 会場: 住之江 — NO_BUY_CANDIDATE

**条件**: `venue='住之江'`

**解説**: 会場住之江のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: NO_BUY_CANDIDATE: ROI=60.00%

n=225 / ROI=60.00% / roiExMaxHit=42.80% / maxHitOdds=38.70


### 会場: 徳山 — NO_BUY_CANDIDATE

**条件**: `venue='徳山'`

**解説**: 会場徳山のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: NO_BUY_CANDIDATE: ROI=67.11%

n=242 / ROI=67.11% / roiExMaxHit=48.80% / maxHitOdds=44.30


### 会場: 福岡 — NO_BUY_CANDIDATE

**条件**: `venue='福岡'`

**解説**: 会場福岡のROI。会場固有の特性（水面・風向き等）が影響する可能性。

**警告**: NO_BUY_CANDIDATE: ROI=68.00%

n=260 / ROI=68.00% / roiExMaxHit=47.81% / maxHitOdds=52.50


### partsあり×強月 — PAPER_ONLY

**条件**: `strong_month AND parts>=1`

**解説**: 強月内でも部品交換ありは除外対象。parts=0との差を確認することで月効果 vs parts効果を分離できる。

**警告**: ⚠️ ROI100.00% — PAPER_ONLYで様子見

n=80 / ROI=100.00% / roiExMaxHit=34.38% / maxHitOdds=52.50


### headFあり×強月 — NO_BUY_CANDIDATE

**条件**: `strong_month AND head_flying>=1`

**解説**: 強月内でもF歴あり頭艇はリスク。isBase条件では除外済みだが、単独ではどの程度影響するか確認。

**警告**: ❌ ROI67.66% — NO_BUY推奨

n=693 / ROI=67.66% / roiExMaxHit=59.00% / maxHitOdds=60.00


### odds>=80×isBase条件 — WATCH

**条件**: `isBase AND odds>=80`

**解説**: isBase条件通過でも高配当帯は一発依存リスクが残る。

**警告**: △ ROI0.00% — 観察中

n=3 / ROI=0.00% / roiExMaxHit=0.00% / maxHitOdds=0.00


---
*生成: 2026-06-08T05:57:10.108Z / DB: data/boat.sqlite*