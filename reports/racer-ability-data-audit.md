# 選手能力データ監査レポート（point-in-time 安全性）

生成日時: 2026-07-20T08:23:50.729Z
DB: data/boat.sqlite

> 本レポートは coverage / point-in-time 安全性の監査のみ。ROI評価・買い条件作成・候補変更は行わない。

## 1. スキーマ棚卸し

- **racer_profiles**: registration_no, flying_count, late_start_count, top3_rate, avg_st, ability_index, fetched_at
- **racer_course_stats**: registration_no, course, races, wins, win_rate, fetched_at, avg_st, entry_rate, top3_rate, start_order
- **race_entries**: race_id, date, venue, race_no, boat, finish_pos, status_code, racer_reg, racer_name, motor_no, boat_no, exhibition_time, entry_course, st, st_flying, source, fetched_at
- **motor_boat_stats**: race_id, date, venue, race_no, course, motor_no, motor_top2_rate, boat_no, boat_top2_rate, imported_at
- **official_programs**: race_id, date, venue, race_no, close_at, source_file, raw_json, imported_at

## 2. raw_json boats[] キー存在調査（年別サンプル200件）

| 年 | sampled | boats[]あり | className | nationalWinRate | localWinRate | motorTop2Rate | boatTop2Rate |
|---|---|---|---|---|---|---|---|
| 2004 | 200 | 198 | 198 | 198 | 198 | 198 | 198 |
| 2005 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2006 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2007 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2008 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2009 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2010 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2011 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2012 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2013 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2014 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2015 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2016 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2017 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2018 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2019 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2020 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2021 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2022 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2023 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2024 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2025 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| 2026 | 200 | 56 | 56 | 56 | 56 | 56 | 56 |

注: avg_st / ability_index / F・L回数 / コース別成績 / 全国・当地3連率 は raw_json boats[] に存在しない。
注: boats[] 欠落 program は全体で 196 件（うち 2026年 144 件）。年別サンプルの欠落はこのクラスタを引いたもの。

## 3. スナップショットテーブルの状態

```json
{
  "racerProfiles": {
    "total": 2660,
    "real_rows": 1637,
    "min_fetched": "2026-07-12T22:54:25.119Z",
    "max_fetched": "2026-07-19T20:05:27.355Z"
  },
  "racerCourseStats": {
    "total": 9840,
    "racers": 1640,
    "min_fetched": "2026-06-07T21:35:28.123Z",
    "max_fetched": "2026-07-13T08:40:09.424Z"
  },
  "motorBoatStats": {
    "total": 682882,
    "min_date": "2024-01-01",
    "max_date": "2026-07-20"
  }
}
```

### 全登録選手（スナップショット自体の充足率）

```json
{
  "profiles": {
    "total": 2660,
    "real_rows": 1637,
    "has_avg_st": 1637,
    "has_ability": 1637,
    "has_top3": 1580
  },
  "courseStats": {
    "racers": 1640,
    "rows": 9840,
    "has_avg_st": 9840,
    "has_top3": 8919,
    "has_entry": 9261,
    "has_start_order": 9840
  }
}
```

## 4. 母集団別 coverage

| 母集団 | races | boats | className | 全国勝率 | 当地勝率 | motor2率 | boat2率 | profiles取得済 | course stats行 | venue motor2率 |
|---|---|---|---|---|---|---|---|---|---|---|
| today_entrants | 155 | 928 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 99.8% |
| today_buy | 3 | 18 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| historical_backfill_buy_all | 6273 | 37350 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 97.1% | 97.3% | 99.2% |
| held_out_2024_buy | 3957 | 23720 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 96.1% | 96.3% | 99.9% |
| forward_2025_plus_buy | 2316 | 13630 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 98.8% | 99.0% | 98.1% |
| since_locked_at_buy | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

### today_entrants — 最新program日 2026-07-20 の全出走艇

```json
{
  "snapshotCoverage": {
    "inRacerProfilesReal": {
      "nonNull": 928,
      "pct": 100
    },
    "profileAvgSt": {
      "nonNull": 928,
      "pct": 100
    },
    "profileAbilityIndex": {
      "nonNull": 928,
      "pct": 100
    },
    "profileFlyingCount": {
      "nonNull": 928,
      "pct": 100
    },
    "profileLateStartCount": {
      "nonNull": 928,
      "pct": 100
    },
    "courseStatsRow": {
      "nonNull": 928,
      "pct": 100
    },
    "courseAvgSt": {
      "nonNull": 928,
      "pct": 100
    },
    "courseTop3Rate": {
      "nonNull": 887,
      "pct": 95.58
    },
    "courseEntryRate": {
      "nonNull": 911,
      "pct": 98.17
    },
    "courseStartOrder": {
      "nonNull": 928,
      "pct": 100
    }
  },
  "motorBoatStats": {
    "raceCourseRows": 928,
    "motorTop2Rate": {
      "nonNull": 928,
      "pct": 99.78
    },
    "boatTop2Rate": {
      "nonNull": 928,
      "pct": 99.78
    }
  }
}
```

### today_buy — paper-live BUY（2026-07-20）

```json
{
  "snapshotCoverage": {
    "inRacerProfilesReal": {
      "nonNull": 18,
      "pct": 100
    },
    "profileAvgSt": {
      "nonNull": 18,
      "pct": 100
    },
    "profileAbilityIndex": {
      "nonNull": 18,
      "pct": 100
    },
    "profileFlyingCount": {
      "nonNull": 18,
      "pct": 100
    },
    "profileLateStartCount": {
      "nonNull": 18,
      "pct": 100
    },
    "courseStatsRow": {
      "nonNull": 18,
      "pct": 100
    },
    "courseAvgSt": {
      "nonNull": 18,
      "pct": 100
    },
    "courseTop3Rate": {
      "nonNull": 16,
      "pct": 88.89
    },
    "courseEntryRate": {
      "nonNull": 17,
      "pct": 94.44
    },
    "courseStartOrder": {
      "nonNull": 18,
      "pct": 100
    }
  },
  "motorBoatStats": {
    "raceCourseRows": 18,
    "motorTop2Rate": {
      "nonNull": 18,
      "pct": 100
    },
    "boatTop2Rate": {
      "nonNull": 18,
      "pct": 100
    }
  }
}
```

### historical_backfill_buy_all — historical-backfill BUY 全期間

```json
{
  "snapshotCoverage": {
    "inRacerProfilesReal": {
      "nonNull": 36272,
      "pct": 97.11
    },
    "profileAvgSt": {
      "nonNull": 36272,
      "pct": 97.11
    },
    "profileAbilityIndex": {
      "nonNull": 36272,
      "pct": 97.11
    },
    "profileFlyingCount": {
      "nonNull": 36272,
      "pct": 97.11
    },
    "profileLateStartCount": {
      "nonNull": 36272,
      "pct": 97.11
    },
    "courseStatsRow": {
      "nonNull": 36335,
      "pct": 97.28
    },
    "courseAvgSt": {
      "nonNull": 36335,
      "pct": 97.28
    },
    "courseTop3Rate": {
      "nonNull": 35013,
      "pct": 93.74
    },
    "courseEntryRate": {
      "nonNull": 35910,
      "pct": 96.14
    },
    "courseStartOrder": {
      "nonNull": 36335,
      "pct": 97.28
    }
  },
  "motorBoatStats": {
    "raceCourseRows": 37350,
    "motorTop2Rate": {
      "nonNull": 37350,
      "pct": 99.23
    },
    "boatTop2Rate": {
      "nonNull": 37350,
      "pct": 99.23
    }
  }
}
```

### held_out_2024_buy — historical-backfill BUY 2024 held-out

```json
{
  "snapshotCoverage": {
    "inRacerProfilesReal": {
      "nonNull": 22802,
      "pct": 96.13
    },
    "profileAvgSt": {
      "nonNull": 22802,
      "pct": 96.13
    },
    "profileAbilityIndex": {
      "nonNull": 22802,
      "pct": 96.13
    },
    "profileFlyingCount": {
      "nonNull": 22802,
      "pct": 96.13
    },
    "profileLateStartCount": {
      "nonNull": 22802,
      "pct": 96.13
    },
    "courseStatsRow": {
      "nonNull": 22836,
      "pct": 96.27
    },
    "courseAvgSt": {
      "nonNull": 22836,
      "pct": 96.27
    },
    "courseTop3Rate": {
      "nonNull": 21982,
      "pct": 92.67
    },
    "courseEntryRate": {
      "nonNull": 22539,
      "pct": 95.02
    },
    "courseStartOrder": {
      "nonNull": 22836,
      "pct": 96.27
    }
  },
  "motorBoatStats": {
    "raceCourseRows": 23720,
    "motorTop2Rate": {
      "nonNull": 23720,
      "pct": 99.91
    },
    "boatTop2Rate": {
      "nonNull": 23720,
      "pct": 99.91
    }
  }
}
```

### forward_2025_plus_buy — historical-backfill BUY 2025-01-01 以降 forward

```json
{
  "snapshotCoverage": {
    "inRacerProfilesReal": {
      "nonNull": 13470,
      "pct": 98.83
    },
    "profileAvgSt": {
      "nonNull": 13470,
      "pct": 98.83
    },
    "profileAbilityIndex": {
      "nonNull": 13470,
      "pct": 98.83
    },
    "profileFlyingCount": {
      "nonNull": 13470,
      "pct": 98.83
    },
    "profileLateStartCount": {
      "nonNull": 13470,
      "pct": 98.83
    },
    "courseStatsRow": {
      "nonNull": 13499,
      "pct": 99.04
    },
    "courseAvgSt": {
      "nonNull": 13499,
      "pct": 99.04
    },
    "courseTop3Rate": {
      "nonNull": 13031,
      "pct": 95.61
    },
    "courseEntryRate": {
      "nonNull": 13371,
      "pct": 98.1
    },
    "courseStartOrder": {
      "nonNull": 13499,
      "pct": 99.04
    }
  },
  "motorBoatStats": {
    "raceCourseRows": 13630,
    "motorTop2Rate": {
      "nonNull": 13630,
      "pct": 98.09
    },
    "boatTop2Rate": {
      "nonNull": 13630,
      "pct": 98.09
    }
  }
}
```

### since_locked_at_buy — historical-backfill BUY lockedAt(2026-06-12) 以降

```json
{
  "snapshotCoverage": {
    "inRacerProfilesReal": {
      "nonNull": 0,
      "pct": null
    },
    "profileAvgSt": {
      "nonNull": 0,
      "pct": null
    },
    "profileAbilityIndex": {
      "nonNull": 0,
      "pct": null
    },
    "profileFlyingCount": {
      "nonNull": 0,
      "pct": null
    },
    "profileLateStartCount": {
      "nonNull": 0,
      "pct": null
    },
    "courseStatsRow": {
      "nonNull": 0,
      "pct": null
    },
    "courseAvgSt": {
      "nonNull": 0,
      "pct": null
    },
    "courseTop3Rate": {
      "nonNull": 0,
      "pct": null
    },
    "courseEntryRate": {
      "nonNull": 0,
      "pct": null
    },
    "courseStartOrder": {
      "nonNull": 0,
      "pct": null
    }
  },
  "motorBoatStats": {
    "raceCourseRows": 0,
    "motorTop2Rate": {
      "nonNull": 0,
      "pct": null
    },
    "boatTop2Rate": {
      "nonNull": 0,
      "pct": null
    }
  }
}
```

## 5. exacta forward monitor 固定6候補の coverage（条件は変更しない）

| 候補 | 期間 | matched | 1号艇 class | 1号艇 全国勝率 | 1号艇 courseAvgSt | 2着艇 class | 2着艇 courseTop3 | motor2率 |
|---|---|---|---|---|---|---|---|---|
| wind 2-3m × 2連単 1-4 | forward | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| wind 2-3m × 2連単 1-4 | pre-lock参考 | 1032 | 100.0% | 100.0% | 96.2% | 100.0% | 95.5% | 100.0% |
| 尼崎 × 2連単 1-3 | forward | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| 尼崎 × 2連単 1-3 | pre-lock参考 | 183 | 100.0% | 100.0% | 97.3% | 100.0% | 96.2% | 100.0% |
| 丸亀 × 2連単 1-2 | forward | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| 丸亀 × 2連単 1-2 | pre-lock参考 | 204 | 100.0% | 100.0% | 93.5% | 100.0% | 92.0% | 98.0% |
| 常滑 × 2連単 1-2 | forward | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| 常滑 × 2連単 1-2 | pre-lock参考 | 288 | 100.0% | 100.0% | 98.9% | 100.0% | 94.0% | 98.1% |
| 大村 × 2連単 1-2 | forward | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| 大村 × 2連単 1-2 | pre-lock参考 | 241 | 100.0% | 100.0% | 95.8% | 100.0% | 94.6% | 100.0% |
| 3R × 2連単 1-4 | forward | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| 3R × 2連単 1-4 | pre-lock参考 | 508 | 100.0% | 100.0% | 95.0% | 100.0% | 96.0% | 99.2% |

注: forward は lockedAt 以降の monitor 母集団と同一クエリ。まだ 0 件の候補は forward レース未蓄積のため。pre-lock参考 は lock 前の同条件母集団での coverage（将来分析の準備であり、ROI評価・買い条件作成はしない）。
注: courseAvgSt / courseTop3Rate は現在値スナップショット由来のため、pre-lock 期間に対しては時点不整合（リーク）であり分析には使わないこと。

## 6. point-in-time 監査

```json
{
  "latestProgramDate": "2026-07-20",
  "racerProfiles": {
    "fetchedAtRange": {
      "min_f": "2026-07-12T22:54:25.119Z",
      "max_f": "2026-07-19T20:05:27.355Z"
    },
    "distinctFetchDays": 3,
    "note": "1世代スナップショットのみ。snapshot履歴なし → 過去レースに当てると未来情報リーク。"
  },
  "racerCourseStats": {
    "fetchedAtRange": {
      "min_f": "2026-06-07T21:35:28.123Z",
      "max_f": "2026-07-13T08:40:09.424Z"
    },
    "distinctFetchDays": 4,
    "note": "同上。enrichFeatures は registrationNo+course だけでJOINし日付条件なし。"
  },
  "historicalBuyDateRange": {
    "min_d": "2024-01-01",
    "max_d": "2026-05-29",
    "races": 6276
  },
  "leakEvidence": {
    "description": "historical-backfill 行の feature_adjustment_breakdown に courseStFactor/courseTop3Factor 非中立が存在する場合、fetched_at がレース日より後のスナップショットを過去レースに適用した証拠になる。",
    "rows_with_breakdown": 1969,
    "course_factor_active": 1938,
    "exhibition_residual_active": 155,
    "min_date": "2025-01-01",
    "max_date": "2025-01-12"
  },
  "motorBoatStats": {
    "note": "race_id 単位で当日番組から取り込むためレース時点で利用可能。point-in-time 安全。"
  },
  "officialProgramsRawJson": {
    "note": "出走表は前売り時点で公表される情報。レース日キー付きで保存されており point-in-time 安全。"
  }
}
```

## 7. 安全分類

| 特徴量 | ソース | 分類 | 備考 |
|---|---|---|---|
| className (A1/A2/B1/B2) | official_programs.raw_json boats[].className | usable_for_historical, currently_used_in_decision | 出走表掲載の時点データ。programFeatures.ts classAdjustment/supportClassAdjustment で使用中。 |
| nationalWinRate | official_programs.raw_json boats[].nationalWinRate | usable_for_historical, currently_used_in_decision | 出走表掲載の時点データ。1着候補の nationalFactor で使用中。 |
| nationalTop2Rate | official_programs.raw_json boats[].nationalTop2Rate | usable_for_historical, not_used_in_decision | 出走表掲載の時点データ。BoatFeature に取り込み済みだが補正係数では未使用。 |
| nationalTop3Rate | （存在しない） | missing_or_low_coverage, needs_schema_change | 出走表raw_jsonにもDBにも全国3連率は存在しない。取得元の追加が必要。 |
| localWinRate | official_programs.raw_json boats[].localWinRate | usable_for_historical, currently_used_in_decision | 出走表掲載の時点データ。1着・2着候補の localFactor で使用中。 |
| localTop2Rate | official_programs.raw_json boats[].localTop2Rate | usable_for_historical, not_used_in_decision | 出走表掲載の時点データ。取り込み済みだが補正係数では未使用。 |
| localTop3Rate | （存在しない） | missing_or_low_coverage, needs_schema_change | 当地3連率は存在しない。 |
| motorTop2Rate（全国） | official_programs.raw_json boats[].motorTop2Rate | usable_for_historical, currently_used_in_decision | 出走表掲載の時点データ。venueMotorTop2Rate のフォールバックとして使用中。 |
| boatTop2Rate（全国） | official_programs.raw_json boats[].boatTop2Rate | usable_for_historical, currently_used_in_decision | 出走表掲載の時点データ。venueBoatTop2Rate のフォールバックとして使用中。 |
| venueMotorTop2Rate / venueBoatTop2Rate | motor_boat_stats (race_id, course 単位) | usable_for_historical, currently_used_in_decision | レースごとに当日の番組から保存。2024-01-01以降のみ。それ以前は needs_backfill。 |
| avg_st（全コース平均ST） | racer_profiles.avg_st（現在値スナップショット） | usable_for_live_only, unsafe_due_to_point_in_time_leakage, not_used_in_decision | fetched_at 2026-05/06 の1世代のみ。過去レースに当てるとリーク。decision の補正係数では未使用。 |
| ability_index | racer_profiles.ability_index（現在値スナップショット） | usable_for_live_only, unsafe_due_to_point_in_time_leakage, not_used_in_decision | 同上。decision では未使用。 |
| flying_count / late_start_count | racer_profiles（現在値スナップショット） | usable_for_live_only, unsafe_due_to_point_in_time_leakage, not_used_in_decision | BoatFeature に注入されるが補正係数では未使用。歴史検証に使うなら期別スナップショットが必要。 |
| courseAvgSt / courseTop3Rate（コース別） | racer_course_stats（現在値スナップショット） | usable_for_live_only, unsafe_due_to_point_in_time_leakage, currently_used_in_decision | courseStFactor / courseTop3Factor として decision に影響。enrichFeatures に日付条件がないため、historical-backfill 再生成時に過去レースへ現在値が注入される（leakEvidence 参照）。 |
| courseEntryRate / courseStartOrder | racer_course_stats（現在値スナップショット） | usable_for_live_only, unsafe_due_to_point_in_time_leakage, not_used_in_decision | 保存のみ。補正係数では未使用。 |
| exhibitionStResidual | exhibition_data（当日直前情報） − racer_course_stats.avg_st（現在値） | usable_for_live_only, unsafe_due_to_point_in_time_leakage, currently_used_in_decision | 展示ST自体は当日情報で安全だが、基準側の courseAvgSt が現在値スナップショットのため残差は時点不整合。 |
| race_entries（racer_reg/entry_course/st/finish_pos 等） | race_entries（結果確定後データ） | usable_for_historical, not_used_in_decision | 結果データとしては全期間あり。ただし『そのレースのst/finish_pos』は事後情報なので、特徴量にするなら race_date より前のレースだけで as-of 集計すること。 |

## 8. コードパス安全性（2026-06-13 実装）

| パス | ファイル | mode | live-only 注入 | guard |
|---|---|---|---|---|
| listProgramInputs (live runtime) | server/db.ts | live | ✅ あり | — |
| listProgramInputsRange (evaluation/report) | server/db.ts | historical-readonly (default) | ❌ なし | ✅ あり |
| listProgramInputsWithOddsSnapshotsRange (evaluation) | server/db.ts | historical (default) | ❌ なし | ✅ あり |
| generate-decision-history (historical write) | scripts/generate-decision-history.ts | historical | ❌ なし | ✅ あり |
| analyze-regenerated-ab (AB comparison) | scripts/analyze-regenerated-ab.ts | historical-readonly | ❌ なし | ✅ あり |
| evaluate-v4-conservative (read-only eval) | scripts/evaluate-v4-conservative.ts | historical-readonly | ❌ なし | ✅ あり |
| analyze-roi-candidates (diagnostic report) | scripts/analyze-roi-candidates.ts | current-snapshot-diagnostic-only | ⚠️ diagnostic (not enrichFeatures path) | — |

## 9. まとめ

- **今すぐ historical に使える**: className / nationalWinRate / nationalTop2Rate / localWinRate / localTop2Rate / motorTop2Rate / boatTop2Rate（raw_json 時点データ）、motor_boat_stats（2024以降）
- **live-only なら使える**: avg_st / ability_index / flying_count / late_start_count / コース別成績（現在値スナップショットのみ）
- **historical 検証には危険**: racer_profiles / racer_course_stats 全カラム、exhibitionStResidual（基準が現在値）
- **coverage 不足**: motor_boat_stats 2024年以前、全国・当地3連率（データ自体が存在しない）
- **schema 変更が必要**: 期別スナップショット（racer_ability_snapshots / racer_course_stats_snapshots）
- **現在 decision で使用中**: className / nationalWinRate / localWinRate / motor・boatTop2Rate / courseAvgSt / courseTop3Rate / exhibitionStResidual
- **未使用だが将来価値あり**: nationalTop2Rate / localTop2Rate / ability_index / F・L回数 / courseEntryRate / courseStartOrder
- **次の最小ステップ**: docs/racer-point-in-time-feature-plan.md のスナップショット設計に従い、live取得時の世代保存を始める（BUY条件追加・ROI探索はしない）

