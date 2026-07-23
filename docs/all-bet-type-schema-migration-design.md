# 全データschema / migration設計（全券種＋選手PIT、DESIGN ONLY）

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
- `source_timestamp_exact`
- `observed_time_only`
- `first_seen_bound`
- `versioned_raw_exact`
- `rounded_display`
- `range_display`
- `derived_strict_prior`
- `post_race_label`
- `timing_ambiguous`

市場値の確定度と時刻品質を1列に畳み込まない実装案もN2/N3で比較する。少なくとも`source_quality`、`timing_quality`、`measurement_quality`は意味を分け、未知値を`exact`へ倒さない。

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

## 選手PIT schema候補

以下も設計レビュー用であり、migrationは適用しない。既存の`official_programs.raw_json`と`race_entries`を生値の正本とし、同じ内容を別tableへ複製しない。`racer_profiles`と`racer_course_stats`はlive最新値の互換tableとして残すが、historical特徴量の正本にはしない。

| 候補 | 責務 | 新設判断 |
|---|---|---|
| `racer_profile_snapshots` | 級別、支部、登録期、年齢、性別、体重等の有効時点付き観測 | 必要。raw provenanceを持つappend-only snapshot |
| `racer_period_stats` | 全国/当地等の期間集計とF/L・事故率 | 必要。公開値と自作rolling値を`period_kind`で分離 |
| `racer_course_period_stats` | 選手×course×任意venueの標本数・平均・分散・戦法count | 必要。ただし`race_entries`から再計算可能な派生table |
| `racer_recent_form_snapshots` | target race直前の30/90走、開催内・同日状態 | 条件付き。target race keyed cacheとして再計算可能にする |
| `racer_pair_history` | target race直前の同走・直接対戦・隣接・同開催再戦 | 条件付き。性能上必要な場合だけmaterialize |
| `racer_style_features` | 戦法・隣接艇・外艇連動の結果由来proxy | 条件付き。因果・主観ラベルにしない |

```sql
CREATE TABLE racer_profile_snapshots (
  id INTEGER PRIMARY KEY,
  registration_no TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  class_name TEXT,
  branch TEXT,
  registration_period INTEGER,
  age INTEGER,
  gender TEXT,
  weight_kg REAL,
  source_type TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  response_sha256 TEXT,
  parser_version TEXT NOT NULL,
  build_mode TEXT NOT NULL CHECK (build_mode IN ('historical_backfill','live_observed')),
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from <= effective_to),
  UNIQUE (registration_no, observed_at, source_reference, parser_version)
);

CREATE INDEX idx_racer_profile_effective
  ON racer_profile_snapshots
  (registration_no, effective_from, effective_to, observed_at);

CREATE TABLE racer_period_stats (
  id INTEGER PRIMARY KEY,
  registration_no TEXT NOT NULL,
  venue_scope TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  observed_at TEXT,
  sample_count INTEGER,
  win_count INTEGER,
  top2_count INTEGER,
  top3_count INTEGER,
  win_rate REAL,
  top2_rate REAL,
  top3_rate REAL,
  st_count INTEGER,
  st_sum REAL,
  st_sum_squares REAL,
  avg_st REAL,
  st_variance REAL,
  flying_count INTEGER,
  late_start_count INTEGER,
  accident_count INTEGER,
  accident_rate REAL,
  source_max_event_at TEXT,
  source_type TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  raw_input_fingerprint TEXT,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  build_mode TEXT NOT NULL CHECK (build_mode IN ('historical_backfill','live_observed')),
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (sample_count IS NULL OR sample_count >= 0),
  CHECK (period_start = 'UNKNOWN' OR period_end = 'UNKNOWN' OR period_start <= period_end),
  UNIQUE (
    registration_no, venue_scope, period_kind, period_start, period_end,
    as_of_date, source_type, feature_version
  )
);

CREATE TABLE racer_course_period_stats (
  id INTEGER PRIMARY KEY,
  registration_no TEXT NOT NULL,
  course INTEGER NOT NULL CHECK (course BETWEEN 1 AND 6),
  venue_scope TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  first_count INTEGER NOT NULL DEFAULT 0,
  second_count INTEGER NOT NULL DEFAULT 0,
  third_count INTEGER NOT NULL DEFAULT 0,
  st_count INTEGER NOT NULL DEFAULT 0,
  st_sum REAL NOT NULL DEFAULT 0,
  st_sum_squares REAL NOT NULL DEFAULT 0,
  flying_count INTEGER NOT NULL DEFAULT 0,
  large_late_count INTEGER NOT NULL DEFAULT 0,
  escape_count INTEGER NOT NULL DEFAULT 0,
  insert_count INTEGER NOT NULL DEFAULT 0,
  sweep_count INTEGER NOT NULL DEFAULT 0,
  sweep_insert_count INTEGER NOT NULL DEFAULT 0,
  missed_first_count INTEGER NOT NULL DEFAULT 0,
  remain_second_or_third_count INTEGER NOT NULL DEFAULT 0,
  entry_change_count INTEGER NOT NULL DEFAULT 0,
  entry_change_top3_count INTEGER NOT NULL DEFAULT 0,
  source_max_event_at TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (sample_count >= 0),
  UNIQUE (
    registration_no, course, venue_scope, period_kind, period_start,
    period_end, as_of_date, feature_version
  )
);

CREATE TABLE racer_recent_form_snapshots (
  target_race_id TEXT NOT NULL,
  registration_no TEXT NOT NULL,
  as_of_event_at TEXT NOT NULL,
  last30_sample_count INTEGER NOT NULL,
  last90_sample_count INTEGER NOT NULL,
  last30_top3_count INTEGER,
  last90_top3_count INTEGER,
  recent_st_count INTEGER,
  recent_st_sum REAL,
  recent_st_sum_squares REAL,
  days_since_flying INTEGER,
  event_previous_finish INTEGER,
  event_previous_st REAL,
  same_day_race_number INTEGER,
  seconds_since_previous_race INTEGER,
  previous_weight_kg REAL,
  current_weight_kg REAL,
  weight_change_kg REAL,
  exhibition_observation_count INTEGER,
  exhibition_time_trend REAL,
  exhibition_st_trend REAL,
  parts_change_observed_at TEXT,
  source_max_event_at TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_race_id, registration_no, feature_version)
);

CREATE TABLE racer_pair_history (
  target_race_id TEXT NOT NULL,
  registration_no_a TEXT NOT NULL,
  registration_no_b TEXT NOT NULL,
  as_of_event_at TEXT NOT NULL,
  prior_same_race_count INTEGER NOT NULL DEFAULT 0,
  a_finished_ahead_count INTEGER NOT NULL DEFAULT 0,
  b_finished_ahead_count INTEGER NOT NULL DEFAULT 0,
  adjacent_course_count INTEGER NOT NULL DEFAULT 0,
  same_event_rematch_count INTEGER NOT NULL DEFAULT 0,
  source_max_event_at TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (registration_no_a < registration_no_b),
  PRIMARY KEY (
    target_race_id, registration_no_a, registration_no_b, feature_version
  )
);

CREATE TABLE racer_style_features (
  target_race_id TEXT NOT NULL,
  registration_no TEXT NOT NULL,
  course INTEGER NOT NULL CHECK (course BETWEEN 1 AND 6),
  as_of_event_at TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  escape_involvement_count INTEGER NOT NULL DEFAULT 0,
  insert_involvement_count INTEGER NOT NULL DEFAULT 0,
  sweep_involvement_count INTEGER NOT NULL DEFAULT 0,
  sweep_insert_involvement_count INTEGER NOT NULL DEFAULT 0,
  adjacent_boat_drop_count INTEGER NOT NULL DEFAULT 0,
  outside_boat_top3_count INTEGER NOT NULL DEFAULT 0,
  lane1_loss_count INTEGER NOT NULL DEFAULT 0,
  lane1_loss_remain_second_count INTEGER NOT NULL DEFAULT 0,
  proxy_definition TEXT NOT NULL,
  source_max_event_at TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_race_id, registration_no, course, period_kind, feature_version)
);
```

率・平均・標準偏差だけを保存しない。可能な限り分子・分母、`st_sum`、`st_sum_squares`を持ち、集計期間と標本数を必須にする。公開sourceが率しか提供しない場合は率を生値として保存し、countを推測しない。

`venue_scope`は全国値を`ALL`、当地値を公式場codeで表し、NULLにしない。SQLiteのUNIQUE制約ではNULL同士が重複可能なため、idempotency keyへ入るscope・period境界には正規化済みsentinelを使う。期間不明の公開値は`period_start / period_end='UNKNOWN'`、`period_kind=source_defined_unknown`と固定した上で、原文・観測時刻・source referenceを保持する。

### point-in-time guard

application/service層とfixture DBの検査で、次を同時に要求する。

```sql
-- target_race_idから得たrace_date / target_event_atに対する概念検査
as_of_date <= race_date
AND (effective_from IS NULL OR effective_from <= race_date)
AND (effective_to IS NULL OR race_date <= effective_to)
AND (source_max_event_at IS NULL OR source_max_event_at < target_event_at)
AND (observed_at IS NULL OR observed_at <= target_feature_cutoff_at)
```

- `fetched_at`を`effective_from`や`as_of_date`の代用にしない
- 同日raceは日付比較だけで通さず、締切・race順で対象raceより厳格に前を要求する
- 対象race自身と対象race後の結果を含むrowはINSERTもreadも拒否する
- snapshotが無い場合はNULLと`missing_reason`を返し、現在値へfallbackしない
- 同一選手・同一属性の有効期間重複は検査でBLOCKする
- historical backfillとlive観測を`build_mode`で分ける
- raw input fingerprint、source範囲、parser/feature version、window定義をrebuild manifestへ固定する
- historical再計算後は同一一意キー・同一fingerprintで値が一致することをidempotency testにする

`racer_pair_history`と`racer_style_features`は必須の生データtableではない。まず`race_entries`からread-onlyで再構築し、性能・再現性の必要が確認された場合だけ派生cacheとしてmaterializeする。師弟関係は公式公開資料の別registryと公開日を正本にし、pair tableへ推測値を混ぜない。

## 独自研究軸schema候補

これらもDESIGN ONLYであり、今回migrationは適用しない。raw observationを優先し、projection、uncertainty、水面状態、Error Atlasは再計算可能な派生監査値とする。

### 公式情報versioning

```sql
CREATE TABLE official_information_observations (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  information_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_published_at TEXT,
  source_observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  raw_sha256 TEXT NOT NULL,
  raw_reference TEXT NOT NULL,
  raw_content_type TEXT,
  parser_version TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  timing_quality TEXT NOT NULL,
  measurement_quality TEXT,
  value_precision REAL,
  late_update_possible INTEGER NOT NULL DEFAULT 1 CHECK (late_update_possible IN (0,1)),
  fetch_status TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (race_id, information_type, source_url, raw_sha256)
);

CREATE INDEX idx_information_observation_timing
  ON official_information_observations
  (race_id, information_type, source_observed_at);

CREATE TABLE official_information_changes (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  information_type TEXT NOT NULL,
  previous_observation_id INTEGER
    REFERENCES official_information_observations(id),
  current_observation_id INTEGER NOT NULL
    REFERENCES official_information_observations(id),
  source_published_at TEXT,
  first_seen_at TEXT NOT NULL,
  changed_at TEXT,
  previous_raw_hash TEXT,
  current_raw_hash TEXT NOT NULL,
  change_type TEXT NOT NULL,
  change_payload TEXT NOT NULL,
  timing_quality TEXT NOT NULL,
  change_detector_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (current_observation_id, change_detector_version)
);
```

`source_published_at`が無い場合はNULLのままにする。`changed_at`も真のsource時刻が確定しなければNULLとし、`first_seen_at`と前回観測時刻の区間を使う。`fetched_at`を公開時刻へcopyしない。

### market batchと120状態projection監査

既存候補の`odds_market_observations_v2`へ`batch_id`を追加し、batch headerを分ける。

```sql
CREATE TABLE market_observation_batches (
  id INTEGER PRIMARY KEY,
  race_id TEXT NOT NULL,
  checkpoint_label TEXT,
  trigger_change_id INTEGER
    REFERENCES official_information_changes(id),
  requested_at TEXT NOT NULL,
  min_observed_at TEXT,
  max_observed_at TEXT,
  observation_skew_ms INTEGER,
  expected_page_count INTEGER NOT NULL,
  completed_page_count INTEGER NOT NULL,
  is_time_aligned INTEGER NOT NULL DEFAULT 0 CHECK (is_time_aligned IN (0,1)),
  alignment_rule_version TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (race_id, checkpoint_label, requested_at)
);

CREATE TABLE market_projection_audit (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL
    REFERENCES market_observation_batches(id),
  projection_version TEXT NOT NULL,
  state_space TEXT NOT NULL CHECK (state_space='ordered_top3_120'),
  source_observation_ids_json TEXT NOT NULL,
  sensor_quality_json TEXT NOT NULL,
  constraint_residuals_json TEXT NOT NULL,
  raw_contradiction_count INTEGER NOT NULL,
  range_handling TEXT NOT NULL,
  takeout_basis_json TEXT,
  projected_state_json TEXT,
  status TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id, projection_version)
);
```

projection rowはraw marketの代替ではない。rangeをpointへ潰さず、発売なし・返還・同着・時刻ずれ・券種間矛盾を`constraint_residuals_json`とsource observation IDで追跡する。控除率が確認できない場合は`takeout_basis_json=NULL`とし、推測値で正規化しない。

### 1マークlabel audit

```sql
CREATE TABLE first_mark_label_audit (
  race_id TEXT NOT NULL,
  label_version TEXT NOT NULL,
  result_confirmed_at TEXT NOT NULL,
  actual_entry_json TEXT,
  actual_st_json TEXT,
  kimarite TEXT,
  lane1_finish INTEGER,
  adjacent_finish_proxy_json TEXT,
  outer_boat_top3_proxy_json TEXT,
  incident_codes_json TEXT,
  attacking_boat INTEGER,
  attacking_boat_quality TEXT NOT NULL,
  indeterminate_reasons_json TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  source_quality TEXT NOT NULL DEFAULT 'post_race_label',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (race_id, label_version),
  CHECK (
    (attacking_boat IS NULL AND attacking_boat_quality='indeterminate')
    OR (
      attacking_boat BETWEEN 1 AND 6
      AND attacking_boat_quality IN ('official_exact','official_derived')
    )
  )
);
```

公式telemetryが無い現在は`attacking_boat=NULL`、`attacking_boat_quality='indeterminate'`とする。上のCHECKもfixture review対象であり、今回migrationしない。勝者や決まり手から攻撃艇を埋めない。

### uncertainty / measurement / latent evidence

```sql
CREATE TABLE uncertainty_feature_snapshots (
  target_race_id TEXT NOT NULL,
  as_of_at TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  state120_concentration REAL,
  first_place_entropy REAL,
  top2_set_entropy REAL,
  top2_order_entropy REAL,
  top3_set_entropy REAL,
  top3_order_entropy REAL,
  similar_race_count INTEGER,
  racer_course_sample_count INTEGER,
  input_missing_count INTEGER NOT NULL,
  cross_market_disagreement REAL,
  odds_volatility REAL,
  entry_uncertainty REAL,
  st_variance REAL,
  point_in_time_quality TEXT NOT NULL,
  data_freshness_seconds INTEGER,
  sample_count INTEGER,
  missing_reason TEXT,
  source_quality TEXT NOT NULL,
  source_max_event_at TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_race_id, as_of_at, feature_version)
);

CREATE TABLE venue_day_evidence_snapshots (
  target_race_id TEXT NOT NULL,
  venue_code TEXT NOT NULL,
  target_event_at TEXT NOT NULL,
  evidence_version TEXT NOT NULL,
  prior_race_count INTEGER NOT NULL,
  effective_sample_size REAL NOT NULL,
  lane1_expectation_residual_sum REAL,
  outer_boat_top3_count INTEGER,
  st_count INTEGER,
  st_sum REAL,
  st_sum_squares REAL,
  kimarite_counts_json TEXT,
  incident_count INTEGER,
  actual_entry_change_count INTEGER,
  pre_race_weather_summary_json TEXT,
  stable_plate_evidence_json TEXT,
  shortened_laps_evidence_json TEXT,
  shrinkage_baseline_key TEXT NOT NULL,
  source_max_event_at TEXT NOT NULL,
  raw_input_fingerprint TEXT NOT NULL,
  missing_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_race_id, evidence_version),
  CHECK (source_max_event_at < target_event_at)
);
```

`uncertainty_feature_snapshots`はSKIP判定ではなく入力監査値、`venue_day_evidence_snapshots`は確定水面stateではなくstrict-prior evidenceである。model出力を保存するtableではない。

measurement metadataは別EAV tableへ安易に複製せず、`beforeinfo_boats_v2`、`beforeinfo_observations_v2`、odds observation、racer snapshotの各観測値へ次を追加する案を優先する。

- `raw_value`
- `measurement_quality`
- `value_precision`
- `value_min / value_max`
- `confidence`
- `source_disagreement`
- `late_update_possible`

### Error Atlas

```sql
CREATE TABLE error_atlas_entries (
  id INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  candidate_created_at TEXT NOT NULL,
  candidate_manifest_sha256 TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  classification_version TEXT NOT NULL,
  result_confirmed_at TEXT NOT NULL,
  primary_error_code TEXT NOT NULL,
  error_codes_json TEXT NOT NULL,
  failed_layer TEXT NOT NULL CHECK (
    failed_layer IN ('data','point_in_time','market','model','price','incident','unknown')
  ),
  source_quality TEXT NOT NULL DEFAULT 'post_race_label',
  human_override INTEGER NOT NULL DEFAULT 0 CHECK (human_override IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (candidate_id, classification_version)
);

CREATE TABLE error_atlas_evidence (
  error_atlas_id INTEGER NOT NULL
    REFERENCES error_atlas_entries(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_row_key TEXT NOT NULL,
  source_observed_at TEXT,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (error_atlas_id, evidence_type, source_table, source_row_key)
);
```

Error Atlasは結果後audit専用で、BUY/WATCH/SKIP条件を自動変更しない。T-5価値消失はT-5とfinal-like双方の実観測がある場合だけ分類し、払戻からfinal oddsを推測しない。

## 一意性とidempotency

- raw responseは`response_sha256`で内容同一性を確認する
- market observationはrace、bet type、checkpoint、観測時刻、source品質を含む
- selection rowはobservation内で一意
- settlementはrace×bet type×source contractで一意
- payout/refundはline番号を保存し、複勝・wide・同着の複数lineを失わない
- parser再実行で同じsourceを重複INSERTせず、内容差分は監査errorとして止める
- `INSERT OR REPLACE`でprovenanceを消さない
- official informationはrace×type×source URL×raw hashで同一内容を一意化し、内容不変pollをchange eventにしない
- market batchは画面間skewを保持し、複数時刻rowのunionで完全市場を作らない
- 派生監査値はinput fingerprint＋versionで一意化し、raw変更時は旧versionを上書きしない
- Error Atlasはcandidate manifestを固定し、再分類はclassification versionを増やす

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
- `racer_profile_snapshots`、`racer_period_stats`、`racer_course_period_stats`をfixture DBで設計検証
- 支部・登録期・年齢・性別・直前体重と当日展示推移をappend-only観測へする

### N4: strict-prior選手派生値

- `racer_recent_form_snapshots`を対象race keyedで再構築
- pair/styleは先にread-only queryで検証し、必要な場合だけmaterialize
- `source_max_event_at < target_event_at`の失敗fixtureを必須にする
- 選手特徴をBUY/WATCH/SKIP条件やモデルへ接続しない

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
