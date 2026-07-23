# 全券種schema / migration設計（DESIGN ONLY）

更新: 2026-07-23

**このSQLは設計レビュー用であり、Phase N0では実行しない。** 現DB、`app_settings`、launchd、既存収集、予測・判定ロジックは変更しない。

## 方針

49,034,366行ある`odds_timeseries_snapshots`へ直接`ALTER`しない。既存3連単の互換契約を保ったまま、全券種用v2 tableを新設する案を第一候補とする。

理由:

- 現tableに`bet_type`がなく、exactaとquinella等のselection表記が衝突する
- point odds 1値しかなく、place / wideのrangeを表せない
- observation単位の完全性、HTTP provenance、parse状態を持てない
- 巨大tableのin-place migrationはlock、容量、rollbackリスクが高い

払戻も既存`race_payouts`を即時置換しない。race×bet_type状態と複数lineを正規化したv2へ新規保存し、照合後にread viewを検討する。

## canonical taxonomy

### bet_type

`win / place / exacta / quinella / wide / trifecta / trio`

未知値を自由文字列で通さない。日本語表示名はUI層で変換する。

### source_type

- `official_web_html`
- `official_download_archive`
- `existing_database_migration`
- `manual_fixture`

### source_quality

- `live_observed`
- `closing_like`
- `historical_closing_odds`
- `official_settlement`
- `fixture_only`

### fetch_status

`success / http_error / timeout / parse_error / cancelled / not_offered`

### availability

`offered / scratched / unavailable / unknown`

### settlement_status

`pending / settled / refunded / cancelled / special_payout / no_sale / parse_error`

## design DDL

以下は名前、制約、一意キーをレビューするための候補。migrationファイルではない。

```sql
CREATE TABLE odds_market_observations_v2 (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK (
    bet_type IN ('win','place','exacta','quinella','wide','trifecta','trio')
  ),
  checkpoint_label TEXT,
  scheduled_close_at TEXT NOT NULL,
  request_started_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_published_at TEXT,
  fetched_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  source_url TEXT NOT NULL,
  http_status INTEGER,
  response_sha256 TEXT,
  parser_version TEXT NOT NULL,
  fetch_status TEXT NOT NULL,
  market_state TEXT NOT NULL,
  active_boats INTEGER CHECK (active_boats BETWEEN 0 AND 6),
  expected_selection_count INTEGER,
  observed_selection_count INTEGER NOT NULL DEFAULT 0,
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1)),
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (race_id, bet_type, checkpoint_label, observed_at, source_type, source_quality)
);

CREATE INDEX idx_odds_market_v2_race_checkpoint
  ON odds_market_observations_v2
  (race_id, bet_type, checkpoint_label, observed_at);

CREATE TABLE odds_selection_observations_v2 (
  observation_id INTEGER NOT NULL
    REFERENCES odds_market_observations_v2(id) ON DELETE CASCADE,
  selection TEXT NOT NULL,
  odds_min REAL,
  odds_max REAL,
  popularity INTEGER,
  availability TEXT NOT NULL,
  raw_value TEXT,
  PRIMARY KEY (observation_id, selection),
  CHECK (odds_min IS NULL OR odds_min > 0),
  CHECK (odds_max IS NULL OR odds_max > 0),
  CHECK (odds_min IS NULL OR odds_max IS NULL OR odds_min <= odds_max)
);

CREATE TABLE race_settlements_v2 (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK (
    bet_type IN ('win','place','exacta','quinella','wide','trifecta','trio')
  ),
  settlement_status TEXT NOT NULL,
  result_kind TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_quality TEXT NOT NULL DEFAULT 'official_settlement',
  source_url TEXT,
  source_file TEXT,
  response_sha256 TEXT,
  parser_version TEXT NOT NULL,
  fetch_status TEXT NOT NULL,
  raw_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (race_id, bet_type, source_type, source_quality)
);

CREATE TABLE race_payout_lines_v2 (
  settlement_id INTEGER NOT NULL
    REFERENCES race_settlements_v2(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  selection TEXT,
  payout_yen INTEGER,
  popularity INTEGER,
  line_kind TEXT NOT NULL,
  PRIMARY KEY (settlement_id, line_no),
  CHECK (payout_yen IS NULL OR payout_yen >= 0)
);

CREATE TABLE race_refund_lines_v2 (
  settlement_id INTEGER NOT NULL
    REFERENCES race_settlements_v2(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  boat_no INTEGER,
  selection TEXT,
  reason_code TEXT,
  PRIMARY KEY (settlement_id, line_no)
);

CREATE TABLE beforeinfo_observations_v2 (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_published_at TEXT,
  fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  response_sha256 TEXT,
  parser_version TEXT NOT NULL,
  weather TEXT,
  wind_direction_code TEXT,
  wind_direction_degrees REAL,
  wind_speed_mps REAL,
  wave_height_cm REAL,
  temperature_c REAL,
  water_temperature_c REAL,
  stable_plate INTEGER,
  shortened_laps INTEGER,
  UNIQUE (race_id, observed_at, response_sha256)
);

CREATE TABLE beforeinfo_boats_v2 (
  observation_id INTEGER NOT NULL
    REFERENCES beforeinfo_observations_v2(id) ON DELETE CASCADE,
  frame_no INTEGER NOT NULL CHECK (frame_no BETWEEN 1 AND 6),
  boat_no INTEGER NOT NULL CHECK (boat_no BETWEEN 1 AND 6),
  exhibition_course INTEGER CHECK (exhibition_course BETWEEN 1 AND 6),
  exhibition_time REAL,
  exhibition_st REAL,
  exhibition_st_status TEXT,
  tilt_angle REAL,
  propeller_changed INTEGER,
  parts_changed_json TEXT,
  PRIMARY KEY (observation_id, frame_no)
);
```

## 一意性とidempotency

- raw responseは`response_sha256`で内容同一性を確認する
- market observationはrace、bet type、checkpoint、観測時刻、source品質を含む
- selection rowはobservation内で一意
- settlementはrace×bet type×source contractで一意
- payout/refundはline番号を保存し、複勝・wide・同着の複数lineを失わない
- parser再実行で同じsourceを重複INSERTせず、内容差分は監査errorとして止める
- `INSERT OR REPLACE`でprovenanceを消さない

`checkpoint_label`だけでは一意にしない。同じcheckpoint内に複数観測があり得る。一方、完全市場判定は単一observationだけで行い、複数時刻のunionで完成させない。

## 既存tableとの対応

| 既存 | 問題 | v2 |
|---|---|---|
| `odds_timeseries_snapshots` | bet_typeなし、range不可、observation headerなし | market + selectionの2table |
| `odds_snapshots` | latest互換、3連単前提 | 当面維持。v2からの互換viewはN2以後 |
| `historical_alternative_odds` | closing履歴としてprovenanceは比較的良い | そのまま維持。無理にlive v2へ移さない |
| `race_payouts` | race状態、同着理由、返還line、parser version不足 | settlement + payout/refund lines |
| `race_weather` | latest、風向なし | append-only beforeinfo header |
| `exhibition_data` | courseの意味が曖昧、latest | frame/boat/exhibition courseを分離 |
| `race_conditions` / `race_entries` | post-race | 結果ラベルとして維持 |

## 段階migration案

### N1-A: schema review

- DDLを実DBへ適用しない
- fixture DBでmigration、rollback、FK、CHECK、一意制約を検証
- `PRAGMA foreign_key_check`と`integrity_check`

### N1-B: payout v2だけ作成

- 明示承認、WAL-safe backup、DB空き容量確認後
- `race_settlements_v2`、`race_payout_lines_v2`、`race_refund_lines_v2`だけ
- 既存結果archiveを少数fixture/canaryでdry-run
- 既存`race_payouts`と5券種を照合し、win/placeを追加検証

### N1-C: payout coverage

- 通常、同着、返還、不成立、特払いを別集計
- parser errorを成功扱いしない
- 既存ROI queryやproduction decisionはv2へ切り替えない

### N2-A: odds v2

- 別タスクでmarket/selection tableだけ作成
- まず1券種、1 checkpoint、少数raceのcanary
- 現行3連単collectorは変更しない

### N2-B: compatibility

- v2のcoverage、complete market、重複率、容量を確認
- read-only viewまたはquery adapterで比較
- 既存table廃止・大規模copyは独立保守タスク

### N3: beforeinfo v2

- 風向と展示courseをfixtureで固定してから実装
- pre-raceとpost-raceを同一tableへ混在させない

## migration前後の検査

前:

- `git status --short`
- DB path、size、mtime、inode、WAL/SHM状態
- `PRAGMA integrity_check`
- 全table row count
- schema hash
- `app_settings` hash
- launchd/collector状態

後:

- `PRAGMA integrity_check`
- `PRAGMA foreign_key_check`
- 既存table row countとfingerprint不変
- `app_settings`不変
- 既存3連単collector dry-run不変
- v2 fixture idempotency
- migration再実行が安全に停止またはno-op
- backupからのrollback手順確認

## rollback

- transaction内のDDL失敗は全rollback
- canary中は既存reader/collectorをv2へ接続しないため、v2作成失敗がproductionへ波及しない
- schema適用後のrollbackは、人間承認の上でv2 tableだけを対象にする
- 原本DBの`DELETE / VACUUM / table rename / DROP`を自動化しない
- 既存49M行のcopy、compact、切替はこのmigrationと分離する

## Phase N0で実行していないこと

- 上記DDLの実行
- migration file作成
- DB backup/restore
- 外部sourceの継続収集
- parser実装
- collector/launchd変更
- `app_settings`変更
- 予測・市場残差・券種選択・production接続
