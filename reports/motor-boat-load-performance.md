# motor_boat_stats load performance

## 結果
| mode | rows | ms |
|---|---:|---:|
| full load | 640088 | 1153.18 |
| scoped historical BUY race_ids | 37266 | 28.01 |

target race_ids: 6260

## index
```json
[
  {
    "name": "idx_motor_boat_stats_boat",
    "sql": "CREATE INDEX idx_motor_boat_stats_boat\nON motor_boat_stats (venue, boat_no, date)"
  },
  {
    "name": "idx_motor_boat_stats_motor",
    "sql": "CREATE INDEX idx_motor_boat_stats_motor\nON motor_boat_stats (venue, motor_no, date)"
  },
  {
    "name": "sqlite_autoindex_motor_boat_stats_1",
    "sql": null
  }
]
```

## 提案
- `loadMotorBoatStatsMap(db)` は全件ロードではなく `loadMotorBoatStatsMapForRaceIds(db, raceIds)` にする。
- `listProgramInputsRange` 系では、先に対象program rowsを取得し、そのrace_idだけで `motor_boat_stats` を読む。
- keyは現状どおり `race_id-course` を維持する。
- 本番変更前に、同一race_idのfeature snapshot一致テストを追加する。
