# ROI Paper Forward Test Report

**条件**: 月4+6+8+12×parts=0 (isBase付き)

**禁止**: 本番decision変更不可 / app_settings変更不可 / 自動投票不可

*生成: 2026-06-08T04:17:24.826Z / DB: data/boat.sqlite*


## 1. 条件定義

```
条件名: seasonal_parts0_month_4_6_8_12
説明: 月4+6+8+12×parts=0 (isBase条件付き)

フィルター:
  - run_kind = 'historical-backfill'
  - decision = 'BUY'
  - month in (4, 6, 8, 12)
  - race_equipment.parts_changed_count = 0 (equipmentPresent=true)
  - exhibition_data 存在必須 (head boat)
  - race_no < 10
  - venue NOT IN ('戸田', '多摩川')
  - wind_speed_mps >= 3
  - headFlyingCount (racer_profiles.flying_count) = 0
  - exSt NOT IN [0.10, 0.15)
```

## 1b. Rerun Safety

```
INSERT OR IGNORE による重複排除: ✅ rerun safe
UNIQUE KEY: condition_name + race_id
  ⚠️ 将来複数selection対応する場合は UNIQUE(condition_name, race_id, selection) を推奨
     (現時点では既存DBがあるため ALTER TABLE しない — 設計メモとして記録)

今回の実行:
  attempted    : 543
  inserted     : 0
  ignored (dup): 543
  total in DB  : 543
```

## 2. Historical Baseline (train+val: 〜2025-08-08)

| 指標 | 歴史検証 | paper forward (確定済み) |
|---|---:|---:|
| n (記録件数) | 543 | 25 |
| 未確定 | - | 0件 |
| hits | 26 | 2 |
| hitRate | 4.79% | 8.00% |
| ROI | **199.10%** | **308.80%** |
| roiExMaxHit | 184.79% | 123.20% |
| roiExMax3Hits | 162.15% | 0.00% |
| parts欠損率 | 0% | 0% (条件による) |

## 3. Forward Test 月別内訳 (2025-08-09〜)

| 年月 | n | 確定済み | hits | hitRate | ROI | maxHitOdds |
|---|---:|---:|---:|---:|---:|---:|
| 2025-08 | 25 | 25 | 2 | 8.00% | 309% | 46.40 |

## 4. Forward Test オッズ帯別 (確定済みのみ)

| オッズ帯 | n | hits | ROI | maxHitOdds |
|---|---:|---:|---:|---:|
| odds<30 | 2 | 0 | 0% | 0.00 |
| 30<=odds<50 | 17 | 2 | 454% | 46.40 |
| 50<=odds<80 | 4 | 0 | 0% | 0.00 |
| odds>=80 | 2 | 0 | 0% | 0.00 |

## 5. 現時点の判定

**判定: ⚠️ PAPER (要観察)**

- Forward期間: 2025-08-09 〜 現在
- 記録件数: 25件 (確定済み: 25件, 未確定: 0件)
- Forward ROI: 308.8%

> **本番反映禁止**: この結果がどうであれ、app_settings や本番 decision ロジックは変更しないこと。

> paper検証として追跡のみ行う。

## 5b. 本番反映条件チェックリスト

**全て ✅ になるまで本番反映しないこと**

| 条件 | 現状 | 判定 |
|---|---|:---:|
| forward n >= 100 | 現在 n=25 | ❌ |
| hit >= 5 | 現在 2hits | ❌ |
| roiExMaxHit >= 100% | 現在 123.2% | ✅ |
| 月8以外を含む (月4/6/12 のいずれか) | 月8のみ | ❌ |
| staleRows = 0 | staleRows=0 | ✅ |
| 本番decision/app_settings 変更なし | 変更なし (このスクリプトは変更しない) | ✅ |

**→ 未達: あと 3 項目。引き続き観測のみ**

## 6. Forward 記録一覧 (先頭30件)

| date | venue | raceNo | selection | odds | result | hit | status |
|---|---|---:|---|---:|---|---|---|
| 2025-08-09 | 平和島 | 6 | 1-2-3 | 82.0 | 5-4-1 | ✗ | forward |
| 2025-08-10 | びわこ | 7 | 1-2-3 | 29.5 | 1-5-3 | ✗ | forward |
| 2025-08-10 | 唐津 | 8 | 1-2-3 | 35.3 | 4-1-2 | ✗ | forward |
| 2025-08-10 | 尼崎 | 4 | 1-2-3 | 39.6 | 2-5-4 | ✗ | forward |
| 2025-08-10 | 平和島 | 5 | 1-2-3 | 50.5 | 1-4-5 | ✗ | forward |
| 2025-08-10 | 平和島 | 8 | 1-2-3 | 76.2 | 1-4-2 | ✗ | forward |
| 2025-08-10 | 平和島 | 9 | 1-2-3 | 90.5 | 2-5-1 | ✗ | forward |
| 2025-08-10 | 浜名湖 | 3 | 1-2-3 | 33.8 | 4-5-2 | ✗ | forward |
| 2025-08-10 | 蒲郡 | 9 | 1-2-3 | 46.7 | 1-2-4 | ✗ | forward |
| 2025-08-11 | びわこ | 2 | 1-2-3 | 46.4 | 1-2-3 | ✓ | forward |
| 2025-08-11 | 下関 | 1 | 1-2-3 | 41.7 | 1-4-5 | ✗ | forward |
| 2025-08-11 | 丸亀 | 4 | 1-2-3 | 41.0 | 5-4-2 | ✗ | forward |
| 2025-08-11 | 唐津 | 8 | 1-2-3 | 41.0 | 2-4-3 | ✗ | forward |
| 2025-08-11 | 尼崎 | 8 | 1-2-3 | 33.6 | 4-2-6 | ✗ | forward |
| 2025-08-11 | 平和島 | 4 | 1-2-3 | 79.8 | 4-3-5 | ✗ | forward |
| 2025-08-11 | 徳山 | 5 | 1-2-3 | 22.1 | 6-1-5 | ✗ | forward |
| 2025-08-11 | 浜名湖 | 4 | 1-2-3 | 31.7 | 1-3-5 | ✗ | forward |
| 2025-08-11 | 若松 | 3 | 1-2-3 | 34.0 | 3-1-5 | ✗ | forward |
| 2025-08-11 | 蒲郡 | 2 | 1-2-3 | 30.8 | 1-2-3 | ✓ | forward |
| 2025-08-11 | 蒲郡 | 3 | 1-2-3 | 55.0 | 3-1-2 | ✗ | forward |
| 2025-08-11 | 蒲郡 | 4 | 1-2-3 | 37.4 | 3-4-5 | ✗ | forward |
| 2025-08-11 | 蒲郡 | 7 | 1-2-3 | 45.1 | 1-4-3 | ✗ | forward |
| 2025-08-12 | びわこ | 2 | 1-2-3 | 45.1 | 1-4-5 | ✗ | forward |
| 2025-08-12 | びわこ | 7 | 1-2-3 | 49.4 | 1-3-6 | ✗ | forward |
| 2025-08-12 | 下関 | 6 | 1-2-3 | 34.8 | 5-3-4 | ✗ | forward |
