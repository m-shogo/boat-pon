# 全データ取得可能性・保存設計監査（全券種＋選手PIT、Phase N0）

生成日時: 2026-07-23T12:34:55.149Z

> 読み取り専用監査。DB migration、実収集、予測ロジック、市場残差モデル、券種選択器、production接続は実施していない。

## 結論

- 7券種の公式払戻は、同一レースの公式結果ページと既存公式日次成績cacheで確認できた。
- 現DBの払戻はexacta / quinella / wide / trifecta / trioのみ。win / placeは公式ソースにあるが現行parserが保存していない。
- 全券種オッズは5つの公式画面に分かれる。現DBのlive timeseriesはbet_type列のない3連単専用で、他券種を安全に混在できない。
- range表示のplace / wide、同着・返還・不成立・特払い、欠場を明示的な状態として保存する必要がある。
- 全race×5画面×4 checkpointは負荷が大きい。サイトポリシーは大量アクセスを禁止しているため、低頻度canaryと運用承認なしに実収集へ進めない。
- 売上・投票口数の取得根拠は未確認。オッズ変化を流動性そのものと呼ばない。
- 選手情報は、当時番組rawとstrict-prior結果再構築は利用可能。一方、現在値racer_profiles / racer_course_statsはhistorical利用不可。

## 7券種判定

| 券種 | 6艇買い目 | 表示 | 払戻 | live時系列 | historical odds | ROI | CLV |
|---|---:|---|---|---|---|---|---|
| 単勝 (win) | 6 | point | **CONDITIONAL** 0 races | **CONDITIONAL** | **UNKNOWN** | 不可 | 不可 |
| 複勝 (place) | 6 | range | **CONDITIONAL** 0 races | **CONDITIONAL** | **UNKNOWN** | 不可 | 不可 |
| 2連単 (exacta) | 30 | point | **GO** 1,186,060 races | **CONDITIONAL** | **GO** | 条件付き可 | 不可 |
| 2連複 (quinella) | 15 | point | **GO** 1,177,350 races | **CONDITIONAL** | **UNKNOWN** | 不可 | 不可 |
| 拡連複 (wide) | 15 | range | **GO** 1,168,591 races | **CONDITIONAL** | **UNKNOWN** | 不可 | 不可 |
| 3連単 (trifecta) | 120 | point | **GO** 1,170,576 races | **GO** | **GO** | 条件付き可 | 3連単のみ可 |
| 3連複 (trio) | 20 | point | **GO** 1,169,370 races | **CONDITIONAL** | **UNKNOWN** | 不可 | 不可 |

判定語:

- GO: 現DBと既存経路で用途に必要な契約がある。
- CONDITIONAL: 公式構造は確認できたが、parser/schema/rate-limit/canaryのいずれかが未完。
- BLOCKED: 必須ソースまたは安全条件がない。
- UNKNOWN: 最小監査では根拠不足。

## 現DB実測

- DB: `data/boat.sqlite`
- table数: 23
- odds_timeseries_snapshots: 49,039,706 rows
- DB total_changes: before=0, after=0
- 監査CLIの外部request: 0
- 監査中DB file変化: あり（並行collector等の外部processと分離）

### 払戻coverage

| bet_type | rows | races | date range | returned rows |
|---|---:|---:|---|---:|
| exacta | 1,186,065 | 1,186,060 | 2000-01-01 .. 2026-06-01 | 58,523 |
| quinella | 1,177,355 | 1,177,350 | 2000-01-01 .. 2026-06-01 | 58,079 |
| trifecta | 1,170,582 | 1,170,576 | 2004-06-01 .. 2026-06-01 | 59,029 |
| trio | 1,169,376 | 1,169,370 | 2004-06-01 .. 2026-06-01 | 57,829 |
| wide | 1,168,596 | 1,168,591 | 2004-06-01 .. 2026-06-01 | 57,417 |
| win | 0 | 0 | — | 0 |
| place | 0 | 0 | — | 0 |

### historical closing odds

| bet_type | source | quality | rows | races | date range |
|---|---|---|---:|---:|---|
| exacta | official_archive | historical_closing_odds | 128,810 | 4,301 | 2024-01-01 .. 2026-05-20 |
| trifecta | official_archive | historical_closing_odds | 2,377 | 476 | 2025-02-01 .. 2026-05-20 |

### 払戻構造anomaly

| bet_type | 複数line race | 最大line数 |
|---|---:|---:|
| exacta | 5 | 2 |
| quinella | 5 | 2 |
| trifecta | 6 | 2 |
| trio | 6 | 2 |
| wide | 5 | 2 |

- canonical範囲外: wide `0-0` = 1 row

複数lineは実在し、2007-10-19下関6Rでは各券種に2つの的中組がある。これは同着等の結果構造を単一rowへ潰せない証拠である。`wide=0-0`も1件あり、過去の特払い等を推測で通常selectionへ変換せずN1 fixtureで意味を固定する。

### 3連単時系列checkpoint

| checkpoint | rows | races | minutes_before_close range | captured range |
|---|---:|---:|---|---|
| T-10 | 24,096,540 | 2,235 | 6 .. 15 | 2026-06-01T09:15:19.284Z .. 2026-07-23T09:28:10.542Z |
| T-20 | 19,711,228 | 4,051 | 11 .. 25 | 2026-06-01T09:15:39.905Z .. 2026-07-23T09:37:30.059Z |
| T-30 | 454,138 | 3,679 | 21 .. 30 | 2026-06-01T09:15:30.661Z .. 2026-07-23T09:37:30.472Z |
| T-5 | 4,777,800 | 835 | 1 .. 10 | 2026-06-02T00:42:55.010Z .. 2026-07-23T09:37:19.629Z |

> rowsには修正前の重複保存を含む。race数は存在coverageであり、単一captured_atの完全市場数ではない。完全性は既存 `audit:t5-market-coverage` / `audit:t5-collector-efficiency` を正本にする。

## point-in-time境界

| データ | 事前利用 | 現状 | 設計判断 |
|---|---|---|---|
| official_programs | 可 | 日付・締切・選手/機材の番組snapshot。現状はimported_at | 将来はsource timestampとobserved_atを分離 |
| race_weather | 可 | beforeinfo由来。風速等あり、風向列なし | observed_atとsource page timestampを分離し、風向を追加 |
| exhibition_data / race_equipment | 可 | 最新値upsert。courseキー | frame/boat/exhibition_courseを分離しappend-only snapshot化 |
| race_conditions | 不可 | 結果archive由来の天候・風向・決まり手 | post-race label専用。事前特徴へ混入禁止 |
| race_entries.entry_course / st / finish_pos | 不可 | 実進入・実ST・結果/事故 | 結果原因ラベル専用 |
| race_payouts | 不可 | 確定後払戻 | ROI settlement専用。オッズ代替禁止 |

## 選手情報・point-in-time監査

判定件数: GO 4 / CONDITIONAL 28 / BLOCKED 3 / UNKNOWN 1

### 現DB・cache実測

| source | rows/files | racers/races | range | coverage / PIT判定 |
|---|---:|---:|---|---|
| official_programs.raw_json boats | 6,861,330 | 2,660 racers | 2004-06-01 .. 2026-07-23 | 登録番号・級別・全国/当地勝率/2連率 100.00%。レース日付きPIT |
| racer_profiles | 2,660 | 実値 1,637 / historical racers 2,944 | 2026-07-12T22:54:25.119Z .. 2026-07-19T20:05:27.355Z | historical coverage 55.60%。現在値1世代、historical不可 |
| racer_course_stats | 9,840 | 1,640 racers、6course完備 1,640 | 2026-06-07T21:35:28.123Z .. 2026-07-13T08:40:09.424Z | races>0 0、win_rateあり 0。n欠落・現在値 |
| race_entries | 7,132,052 | 1,190,383 races / 2,944 racers | 2000-01-01 .. 2026-06-01 | reg欠損 0、ST欠損 797。strict-prior派生の正本 |
| 公式番組archive | 7,891 files | — | 2004-06-01 .. 2026-07-23 | 当時番組を再parse可能 |
| 公式結果archive | 8,164 files | — | 2000-01-01 .. 2026-07-22 | 結果由来rollingを再計算可能 |
| レース前HTML cache | 272,671 files | — | 2020-01-01 .. 2026-05-21 | 年齢・支部・性別・体重を当時値で再抽出可能 |

最新番組日 2026-07-23 は 929艇すべてprofile/course statsでcovered。ただし「現在coverage 100%」は過去raceでのPIT適格性を意味しない。

### Go / No-Go matrix

| 分類 | feature | 判定 | PIT品質 | 現在source / 過去再現 | 実測coverage / 欠損・重複 / parser | 新規取得 | phase | 主な漏洩リスク |
|---|---|---|---|---|---|---|---|---|
| basic | registration_no | **GO** | exact_pre_race | official_programs.raw_json / race_entries。2004-06-01以降は番組、2000-01-01以降は結果から再現 | rows=6861330, racers=2660, range=2004-06-01..2026-07-23; missing=0.0000%; duplicate=raw_json内boat keyは未制約。race_id自体はofficial_programsで一意; parser=DB rowに未記録 | 不要 | M1 | 低 |
| basic | class_name | **GO** | exact_pre_race | official_programs.raw_json。レース当時の級別を100%保持 | rows=6861330, racers=2660, range=2004-06-01..2026-07-23; missing=0.0000%; duplicate=raw_json内boat keyは未制約。race_id自体はofficial_programsで一意; parser=DB rowに未記録 | 不要 | N3 | 現在profileで上書きすると級別変更を失う |
| basic | branch | **CONDITIONAL** | partial_cache | 保存済みkyotei24レース前HTML。2020-01-01〜2026-05-21 cache範囲は再抽出可能 | rows=—, racers=—, range=2020-01-01..2026-05-21; missing=UNKNOWN（N0はfile inventory実測。項目別再parseは未実施）; duplicate=UNKNOWN（HTML内容hash未監査）; parser=cache inventoryには未記録 | 未cache期間とforwardは公式source追加が必要 | N3 | 現在支部を過去へ適用しない |
| basic | registration_period | **UNKNOWN** | unavailable | 公式の構造化source未確認。登録番号近接proxyは登録期ではない | rows=0, racers=0, range=—; missing=100%（監査対象の構造化sourceでは未確認）; duplicate=not applicable; parser=なし | 公式source確認が必要 | N3 | 番号差から登録期を推測しない |
| basic | age_gender_weight | **CONDITIONAL** | partial_cache | 保存済みkyotei24レース前HTML / beforeinfo。cache範囲は年齢・性別・体重を当時値で再抽出可能 | rows=—, racers=—, range=2020-01-01..2026-05-21; missing=UNKNOWN（N0はfile inventory実測。項目別再parseは未実施）; duplicate=UNKNOWN（HTML内容hash未監査）; parser=cache inventoryには未記録 | 公式forward sourceと体重parserが必要 | N3 | 現在年齢・現在体重で過去を上書きしない |
| basic | national_win_top2_rate | **GO** | exact_pre_race | official_programs.raw_json。2004-06-01以降100% | rows=6861330, racers=2660, range=2004-06-01..2026-07-23; missing=0.0000%; duplicate=raw_json内boat keyは未制約。race_id自体はofficial_programsで一意; parser=DB rowに未記録 | 不要 | M1 | 掲載値の対象期間metadataがrawにない |
| basic | national_top3_rate | **BLOCKED** | unavailable | 現DB/raw JSONに無し。再現不可 | rows=6861330, racers=2660, range=2004-06-01..2026-07-23; missing=100.0000%; duplicate=raw_json内boat keyは未制約。race_id自体はofficial_programsで一意; parser=DB rowに未記録 | 公式sourceと対象期間の確認が必要 | N3 | 現在値や2連率から補間しない |
| basic | local_win_top2_rate | **GO** | exact_pre_race | official_programs.raw_json。2004-06-01以降100% | rows=6861330, racers=2660, range=2004-06-01..2026-07-23; missing=0.0000%; duplicate=raw_json内boat keyは未制約。race_id自体はofficial_programsで一意; parser=DB rowに未記録 | 不要 | M1 | 当地の対象期間metadataがrawにない |
| basic | local_top3_rate | **BLOCKED** | unavailable | 現DB/raw JSONに無し。再現不可 | rows=6861330, racers=2660, range=2004-06-01..2026-07-23; missing=100.0000%; duplicate=raw_json内boat keyは未制約。race_id自体はofficial_programsで一意; parser=DB rowに未記録 | 公式sourceと対象期間の確認が必要 | N3 | 2連率から補間しない |
| basic | average_st | **CONDITIONAL** | current_only | racer_profiles / race_entries。現在値は不可。過去結果からas-of rolling値は再構築可能 | rows=2660, racers=1637, range=2026-07-12T22:54:25.119Z..2026-07-19T20:05:27.355Z; missing=38.4586%; duplicate=0%（registration_no PRIMARY KEY）; parser=DB rowに未記録 | 公式期別値を使うならsnapshot取得が必要 | N3 | fetched_atを有効時点とみなさない |
| basic | f_l_counts | **CONDITIONAL** | current_only | racer_profiles / race_entries.status_code。2000年以降のprior resultから累積・window別に再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 公式期別値にはsnapshotが必要 | N4 | 対象race自身と以後を集計しない |
| basic | accident_rate | **CONDITIONAL** | prior_results_derived | race_entries.status_code。分母・事故code・windowを固定すれば再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 定義変更と左打切り |
| course | starts_finish_rates_by_course | **CONDITIONAL** | prior_results_derived | race_entries。出走数・1/2/3着率を2000年以降のprior resultsから再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 標本数なしの率、対象race混入 |
| course | st_mean_std_by_course | **CONDITIONAL** | prior_results_derived | race_entries。平均・標準偏差・nをprior resultsから再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | F/ST欠測の扱いと対象race混入 |
| course | f_late_start_rates_by_course | **CONDITIONAL** | prior_results_derived | race_entries。code定義と分母を固定すれば再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | lateの閾値後付け |
| course | winning_style_by_course | **CONDITIONAL** | prior_results_derived | race_conditions.kimarite + race_entries。本人が1着時の決まり手傾向は再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 勝者戦法と他艇の因果を混同 |
| course | remain_top2_top3_after_losing_from_course1 | **CONDITIONAL** | prior_results_derived | race_entries。1コース敗戦時の2/3着残り率を再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 対象race混入 |
| course | entry_change_performance | **CONDITIONAL** | prior_results_derived | race_entries.boat / entry_course。枠と実進入差から再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 枠を展示/実進入と混同 |
| course | venue_course_performance | **CONDITIONAL** | prior_results_derived | race_entries。venue×実進入×選手で再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 細分化小標本 |
| recent | last_30_90_results | **CONDITIONAL** | prior_results_derived | race_entries。registration_no順の直前30/90走を再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 同日後続race・対象race混入 |
| recent | recent_st_mean_variance | **CONDITIONAL** | prior_results_derived | race_entries。window・F除外規則・nを固定すれば再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 全期間平均と混同 |
| recent | days_since_f | **CONDITIONAL** | prior_results_derived | race_entries.status_code / st_flying。直前F日からrace dateまでで再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 履歴開始前Fを不在扱い |
| recent | event_previous_finish_st | **CONDITIONAL** | prior_results_derived | race_entries + official_programs。同日・同場の前raceは既存処理で再構築済み | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0.0112% ST; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 開催event_idの正規化が必要 | N4 | 開催境界誤認、後続race混入 |
| recent | same_day_run_number_and_interval | **CONDITIONAL** | prior_results_derived | official_programs.close_at + race_entries。当日それ以前のraceだけで再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=0% registration / actual course。派生値自体は未materialize; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | race_noだけで時系列を決めない |
| recent | weight_change | **CONDITIONAL** | partial_cache | 保存済みレース前HTML / future beforeinfo。cache範囲のみ再構築可能 | rows=—, racers=—, range=2020-01-01..2026-05-21; missing=UNKNOWN（N0はfile inventory実測。項目別再parseは未実施）; duplicate=UNKNOWN（HTML内容hash未監査）; parser=cache inventoryには未記録 | 公式forward sourceとparserが必要 | N3 | 静的profile体重と直前体重を混同 |
| recent | exhibition_time_st_day_trend | **CONDITIONAL** | partial_cache | exhibition_data + official_programs。取得済race間は同日prior trendを再構築可能 | rows=—, racers=—, range=—; missing=UNKNOWN（既存latest tableからPIT observation coverageを分離できない）; duplicate=not applicable（未materialize）; parser=既存parser。observation rowには未固定 | 欠測補完ではなくforward蓄積が必要 | N3 | 同race後の観測やlatest上書き |
| recent | post_parts_change_delta | **CONDITIONAL** | partial_cache | race_equipment + exhibition_data。取得済み同日prior race間の変化は再構築可能 | rows=—, racers=—, range=—; missing=UNKNOWN（既存latest tableからPIT observation coverageを分離できない）; duplicate=not applicable（未materialize）; parser=既存parser。observation rowには未固定 | forward蓄積が必要 | N3 | 交換後の対象race結果を事前値に混入 |
| interaction | course_tactic_tendency | **CONDITIONAL** | prior_results_derived | race_conditions.kimarite + race_entries。勝者本人の戦法傾向として再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 攻め手の同定を推測しない |
| interaction | adjacent_boat_drop_when_attacking | **BLOCKED** | unavailable | 1マークの攻め手telemetry無し。着順共起proxyは作れるが因果的な攻め手を特定不可 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 公式lap/turn telemetry等が必要 | M3 | 着順共起を妨害効果と断定 |
| interaction | outer_boat_rise_with_attack | **CONDITIONAL** | prior_results_derived | race_entries + kimarite。勝者戦法時の外艇上位共起proxyは再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 連動・因果と呼ばない |
| interaction | course1_loss_second_place_rate | **CONDITIONAL** | prior_results_derived | race_entries。prior resultsから再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 対象race混入 |
| interaction | past_meetings_direct_results | **CONDITIONAL** | prior_results_derived | race_entries。既存処理がprior-day順で再構築済み | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 同日未来race混入 |
| interaction | adjacent_course_matchups | **CONDITIONAL** | prior_results_derived | race_entries.entry_course。過去同走の実進入差から再構築可能 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | 不要 | N4 | 枠と実進入を混同 |
| interaction | same_event_rematch | **CONDITIONAL** | prior_results_derived | official_programs + race_entries。同日再戦は既存処理あり。開催全体はevent_id不足 | rows=7132052, racers=2944, range=2000-01-01..2026-06-01; missing=1.3626% finish; duplicate=0%（race_id,boat_number PRIMARY KEY）; parser=DB rowに未記録。再構築時feature_version必須 | event_id正規化が必要 | N4 | 開催境界誤認 |
| interaction | same_branch | **CONDITIONAL** | partial_cache | 保存済みレース前HTML。cache範囲は当時支部で再構築可能 | rows=—, racers=—, range=2020-01-01..2026-05-21; missing=UNKNOWN（N0はfile inventory実測。項目別再parseは未実施）; duplicate=UNKNOWN（HTML内容hash未監査）; parser=cache inventoryには未記録 | 未cache期間とforward sourceが必要 | N3 | 同支部を私的関係と解釈しない |
| interaction | official_mentor_apprentice | **CONDITIONAL** | exact_pre_race | docs/official-racer-relationships.json。公式記事2組のみ、記事公開日以後に限定 | rows=2, racers=4, range=—; missing=UNKNOWN（非網羅registry）; duplicate=0%（登録済み2組のkey）; parser=hand-curated official-source registry | 網羅的公式registryが必要 | N3 | 非網羅・公開日前利用 |

### 安全分類

現在すでに使える:

- 登録番号、当時級別、全国/当地勝率・2連率（official_programs.raw_json、2004-06-01以降）
- 結果履歴の登録番号、実進入、実ST、着順、事故code（race_entries、2000-01-01以降）
- 保存済みレース前HTML範囲の年齢・支部・性別・体重
- prior-day順で再構築する過去同走・直接対戦・同日以前の前走状態

point-in-time不適格:

- racer_profiles全列をhistoricalへ直接JOIN
- racer_course_stats全列をhistoricalへ直接JOIN
- 現在プロフィールから過去の級別・支部・年齢・体重を補完
- 対象raceまたは同日後続raceをrolling集計へ含める
- race_conditions/race_entriesの対象race結果を事前特徴へ含める

最優先:

- P0: raw programの当時級別・全国/当地勝率/2連率を正本として明示
- P0: race_entriesからstrict priorのn付き30/90走、ST平均/分散、F後日数を再現可能にする設計
- P1: profile/period/course-period snapshotのeffective期間と集計窓を保存
- P1: beforeinfoの直前体重、展示course/ST/timeをappend-only観測として保存
- P2: pair/styleはraw結果から再計算を正本とし、性能上必要な場合だけmaterialize

guard:

- observed_at <= race close前の許容時刻
- as_of_date < race date、同日値はevent order/close_atで厳格に先行
- effective_from <= race date <= effective_to
- source max event time < target event time
- snapshot欠損時はNULL。現在値fallback禁止
- raw input fingerprint + parser_version + feature_version + window definitionを固定

### N1〜N4

- N1: 変更なし。全券種払戻基盤のみ。選手特徴を混ぜない。
- N2: 変更なし。全券種odds時系列のみ。選手特徴を混ぜない。
- N3: profile/period/course-periodのPIT snapshot、支部/年齢/性別/直前体重、展示/装備append-only。
- N4: race_entries/conditionsからstrict-prior recent form、course、pair、style proxyを再構築。対象race結果を拒否。

選手特徴を現在のBUY/WATCH/SKIPへ追加しない。M1/M3は既存のformal settled gateとN3/N4のPIT基盤が揃うまで開始しない。

## 独自研究軸監査

判定件数: GO 0 / CONDITIONAL 7 / BLOCKED 0 / UNKNOWN 0

| 研究軸 | 判定 | 現在データ | 新規取得 | 過去再構築 | future-only | 推奨Phase | 必要schema | 追加request cost | 主な漏洩リスク |
|---|---|---|---|---|---|---|---|---|---|
| 公式情報の市場反映遅延 | **CONDITIONAL** | PARTIAL: beforeinfo系はlatest upsert、3連単oddsはcheckpoint時系列。source公開時刻・変更履歴・全券種同期観測がない | 必要: 公式情報のversioned observationと、変更後lag checkpointごとの全5市場画面 | BLOCKED_FOR_LAG: 保存済みHTMLから値は部分再抽出可能だが、first_seen/changed_atと30秒〜5分反応は再現不可 | 必要: 公開時刻がないsourceのfirst_seen bound、変更後30秒/1分/3分/5分反応 | N2/N3で観測基盤、N5以降で研究 | official_information_observations, official_information_changes, odds_market_observations_v2 | 情報観測はsource page数×poll回数。反応計測は1 changeあたり5市場画面×lag checkpoint数。正確な日次costは変更頻度実測までUNKNOWN | 取得完了時刻を公開時刻と偽装、変更後に取得した値を変更前oddsへ結合、券種間の観測時刻ずれ |
| 全券種市場整合性 | **CONDITIONAL** | TRIFECTA_ONLY: 7券種の公式画面構造は確認済みだが、live時系列は3連単のみ。複勝・拡連複はrange | 必要: 同一観測batchで5画面・7券種の全selection、発売状態、range、返還状態を保存 | BLOCKED_FOR_ALL_MARKETS: 既存3連単のみ部分可。過去の全券種同時点整合性は再現不可 | 必要: 券種別ノイズ・波及順序・同時点矛盾の評価 | N2で保存、N5以降で120状態投影研究 | market_observation_batches, odds_market_observations_v2, odds_selection_observations_v2, market_projection_audit | 既存設計どおり1 checkpointあたり5 page。投影・制約検査自体は0 request | 異なる観測時刻を同時市場として投影、range midpointの確定値化、返還後marketを事前値へ混入 |
| 1マーク因果グラフのデータ前提 | **CONDITIONAL** | PARTIAL_PROXY_ONLY: 展示進入/ST、実進入/ST、決まり手、着順、事故は部分〜広範囲に存在。公式の攻撃艇telemetryはない | 必要: 展示・装備のappend-only観測。攻撃艇の公式sourceが見つからない限り因果labelは追加しない | PARTIAL: 実進入→実ST→決まり手→上位3着と共起proxyは再構築可能。攻撃艇・隣接艇を潰した因果は不可 | 必要: 展示の直前versionと当時PIT品質を伴う完全graph input | N3/N4でdata/label、M3で研究 | beforeinfo_observations_v2, first_mark_label_audit, racer_style_features | 既存beforeinfo観測と結果取得を再利用する限り0。追加telemetry sourceはUNKNOWN | 決まり手・実ST・着順をレース前特徴へ混入、勝者を攻撃艇と機械的同一視、共起を因果と断定 |
| SKIP予測器・選択的予測 | **CONDITIONAL** | PARTIAL: 選手標本数・PIT品質の一部は監査可能だが、全券種120状態分布・券種間不一致・完全な鮮度metadataは未整備 | 必要: 上流のN2/N3観測のみ。SKIP専用の追加外部sourceは不要 | PARTIAL: 既存3連単と結果から一部entropy/類似数は可能。全券種不一致と当時欠損maskは不可 | 必要: 完全な入力欠損mask、観測skew、全券種不一致、forward calibration | N5で監査値、N6以降で研究 | uncertainty_feature_snapshots, market_projection_audit | 上流観測を再利用するため追加0 request | 対象結果で予測可能性labelを最適化、欠損を0補完、将来標本数・将来calibrationを使用 |
| 入力摂動とFragility Index | **CONDITIONAL** | PARTIAL_VALUES_ONLY: 値は存在するが、表示precision、measurement error、confidence、late update metadataがほぼない | 必要: 同一sourceのraw表示、丸め単位、range、version変更履歴を観測rowへ追加 | PARTIAL_RAW_CACHE_ONLY: raw HTMLが残る範囲は表示precisionを部分再抽出可能。late update順序は不可 | 必要: source間差、更新頻度、late update probabilityの較正 | N2/N3でmetadata、N5以降で研究 | measurement_quality_fields on observation tables, input_perturbation_manifests | raw表示とversionを同じresponseから保存するなら0。source比較を追加する場合はsource数に比例しUNKNOWN | 表示丸めより細かい擬似精度、将来判明した更新幅で過去候補を摂動、source差を誤差と断定 |
| 潜在水面状態 | **CONDITIONAL** | PARTIAL: 長期結果に実進入/ST/決まり手/事故/着順、直近期間にpre-race風波・安定板・周回短縮がある | 必要: pre-race風向とappend-only観測の継続。状態推定専用の追加requestは不要 | PARTIAL_STRICT_PRIOR: 同日strict-prior結果から市場期待残差以外の多くを再構築可能。市場期待は保存odds範囲のみ | 必要: 完全なpre-race風向、全券種市場期待、観測鮮度付き逐次更新 | N4でstrict-prior台帳、N5以降で研究 | venue_day_evidence_snapshots, water_state_rebuild_manifests | 既存結果・上流pre-race観測を再利用するため追加0 request | 対象race以後の結果、払戻/高配当を荒れ定義に使用、2〜3raceで状態確定、会場・季節差の無視 |
| Error Atlas | **CONDITIONAL** | CURRENT_TRIFECTA_PAPER_PARTIAL: decision_history、公式上位3着、実進入/ST/事故、3連単T-5、5券種払戻があり現行paper候補は多くを分類可能 | 必要: 単勝・複勝払戻、全券種T-5/final-like、PIT監査reasonの固定保存 | PARTIAL: 既存候補の着順誤り・集合/順序誤り・券種変換的中・事故は再構築可能 | 必要: 全券種T-5価値→final-like価値消失、当時PIT不適格理由、観測時点別市場対モデル比較 | N4で監査台帳、N5/N8で市場・モデル層分類 | error_atlas_entries, error_atlas_evidence | 保存済みdecision/resultを使う分類は0。価格層分類はN2の観測を再利用 | 結果を見てBUY条件を変更、final price欠測を払戻から推測、当時利用不能なfeatureで失敗原因を説明 |

### 特に有望な上位3項目

1. **Error Atlas** — 既存decision_history・公式結果・事故・3連単T-5で現行paper候補の失敗層を最も早く監査でき、追加requestは上流観測の再利用で済む。
2. **潜在水面状態** — 長期結果から同日strict-prior evidenceを再構築できる。高配当依存でない状態証拠と会場・季節baselineを分離できる。
3. **SKIP予測器・選択的予測** — 標本数・欠損・PIT品質を保存する設計は他の全研究軸にも共通し、専用外部requestを増やさず将来のSKIP監査基盤になる。

### 公式情報の市場反映遅延

| event | source | source公開時刻 | 根拠 | 現在version | 過去lag | timing quality | 判定 |
|---|---|---|---|---|---|---|---|
| 出走表公開・更新 | official_programs/raw program | 正確な時刻は未確認/未保存 | 公式説明は通常18時頃等の概算表示予定。race/versionごとの正確な公開時刻ではない | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 欠場 | official program / odds / beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | partial_latest | future_only | observed_time_only | **CONDITIONAL** |
| 展示進入 | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 展示ST | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 展示タイム | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| チルト | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 部品交換 | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 風向・風速・波高 | beforeinfo | 正確な時刻は未確認/未保存 | 公式画面に「11R時点」等のrace相対markerはあるが、壁時計の公開時刻ではない | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 安定板 | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 周回短縮 | beforeinfo | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |
| 締切時刻変更 | official program | 正確な時刻は未確認/未保存 | 監査sampleの表示内容と現保存schemaに個別の壁時計公開/更新時刻なし | single_latest | future_only | observed_time_only | **CONDITIONAL** |

- 公式説明は翌日出走表の表示開始を通常18時頃・サマー20時頃・ナイター22時頃とするが、race/version単位の正確な公開時刻ではない。
- 直前情報sampleは水面気象を「11R時点」のようなrace相対markerで示すが、壁時計の公開時刻を表示しない。
- 公式説明はlive oddsについて「オッズ更新時間」参照とする。将来parserは表示有無を券種・状態別に保存し、HTTP観測時刻と分離する。
- 締切時オッズsampleは締切時状態を示すが、最終確定ではなくスタート事故等を反映しない。

現行`official_programs`、`race_weather`、`exhibition_data`、`race_equipment`はrace keyの最新1世代で、source自身の公開時刻と変更versionを保存していない。`fetched_at / imported_at`は観測・取込時刻であり、公開時刻ではない。将来はraw hash付きappend-only observationからchange eventを生成し、source時刻が無ければ`first_seen_bound`として前回観測〜first seenの区間を保持する。

反応lag候補: 30 / 60 / 180 / 300秒。全5市場画面を同一batchで取得しても各HTTP応答時刻は異なるため、batch内skewを保存し、一つの券種だけ遅い場合をraw evidenceとして残す。

### 全券種市場整合性

共通状態は上位3着順序付き120状態。sensorはwin / place / exacta / quinella / wide / trifecta / trio。

- 120状態は非負・総和1
- win/exacta/trifectaは順序制約
- quinella/trio/wideは集合制約
- place/wide rangeをpointへ丸めない
- 発売なし・欠場・返還・同着を確率0と同一視しない
- 券種ごとのobserved_atとbatch skewを保持
- 控除率は公式根拠・適用期間付きで保存し、未知はNULL

各券種を異なるノイズ水準のsensorとして扱うが、今回projection/modelは実装しない。raw point/range、発売状態、返還、同着、observed_at、source hashを正本とし、矛盾した値をprojectionで上書きしない。

### 1マーク因果グラフの境界

| 項目 | 役割 | source | 判定規則 |
|---|---|---|---|
| 展示進入 | pre_race_feature | beforeinfoの観測時点付きraw | append-only化後に利用可 |
| 展示ST | pre_race_feature | beforeinfoの観測時点付きraw | append-only化後に利用可 |
| 展示タイム | pre_race_feature | beforeinfoの観測時点付きraw | append-only化後に利用可 |
| コース別ST平均・分散 | pre_race_feature | strict-prior race_entries | n・window・as_of必須 |
| 実進入 | post_race_label | race_entries.entry_course | 教師/監査専用 |
| 実ST | post_race_label | race_entries.st/status_code | 教師/監査専用 |
| 決まり手 | post_race_label | race_conditions.kimarite | 教師/監査専用 |
| 1号艇の残り方 | post_race_derived_label | 公式着順 | 定義固定で再現可 |
| 隣接艇の着順変化 | post_race_proxy | 実進入と着順 | baseline比較が必要、因果表現禁止 |
| 外艇の連動 | post_race_proxy | 実進入と着順 | 共起のみ、因果表現禁止 |
| 攻撃艇 | undetermined | 公式telemetry未確認 | 勝者・決まり手から主観補完しない |

公式rawで再現できるのは、展示→実進入/ST→決まり手・着順の時系列と共起proxyまで。「攻撃艇」「隣接艇を潰した」は公式telemetryが無い限り判定不能とし、勝者や決まり手から主観で補完しない。

### 選択的不確実性・Fragility

不確実性値は as_of_at, sample_count, missing_reason, source_quality, feature_version を必須とする。対象は state120_concentration, first_place_entropy, top2_set_entropy, top2_order_entropy, top3_set_entropy, top3_order_entropy, similar_race_count, racer_course_sample_count, input_missing_count, cross_market_disagreement, odds_volatility, entry_uncertainty, st_variance, point_in_time_quality, data_freshness_seconds。

Fragility対象は、値だけでなく`measurement_quality / value_precision / value_min / value_max / source_disagreement / late_update_possible`を観測時点付きで保存する。表示丸めより細かい擬似精度を作らない。

### 潜在水面状態

- source_max_event_at < target_event_at
- 高配当だけを荒れlabelにしない
- 会場・季節baselineへ縮小可能にする
- evidence_countとeffective_sample_sizeを保存
- 少数raceで確定状態にしない
- 従来の手動水面ムード条件と別namespace/versionにする

状態値自体は今回作らない。対象raceより前のevidenceだけをappendし、会場・季節baseline、evidence count、effective sample sizeを保存できる設計に限定する。

### Error Atlas

分類code: first_place_error, second_place_error, third_place_error, top2_set_correct_order_wrong, top3_set_correct_order_wrong, win_would_hit, place_would_hit, exacta_would_hit, quinella_would_hit, trio_would_hit, value_at_t5_lost_at_final_like, entry_change, abnormal_start, incident_or_fl, missing_input, point_in_time_ineligible, market_and_model_wrong, market_right_model_wrong

Error Atlasは結果後の研究台帳であり、BUY条件探索器ではない。candidate時点のmanifest/input fingerprintを凍結し、データ層・市場層・モデル層のどこが失敗したかを分類する。

### source-quality / point-in-time

| code | meaning |
|---|---|
| source_timestamp_exact | source自身の公開/更新時刻が日付・timezone込みで確定 |
| observed_time_only | source時刻なし。取得観測時刻のみ |
| first_seen_bound | poll間で初めて変化を観測。真の公開時刻は前回観測後〜first_seenの区間 |
| versioned_raw_exact | raw hashと前version hashを持つappend-only観測 |
| rounded_display | 表示丸め単位を保持するpoint値 |
| range_display | source表示のmin/maxを保持 |
| derived_strict_prior | 対象eventより前だけからversion付き再構築 |
| post_race_label | 結果確定後の教師/監査label。事前特徴利用不可 |
| timing_ambiguous | source日付・timezone・更新時刻を一意に決められない |

- fetched_atをsource_published_atとして扱わない
- 同一raceの情報とmarketは各observed_atを保持し、batch内時刻skewを検査する
- change lagはfirst_seen_at以後のmarket observationだけで測る
- 対象race結果・対象race後情報をpre-race特徴へ入れない
- post-race labelとpre-race featureを同じ列/qualityで保存しない
- 派生値はsource_max_event_at、input fingerprint、feature versionを持つ
- 欠測・発売なし・未観測・PIT不適格を別reason codeにする
- raw contradictionを正規化処理で上書きしない

### 独自研究軸のrequest cost

| scenario | unit | formula | additional requests | note |
|---|---|---|---:|---|
| information-versioning-single-pass | 144-race design day | 144 races × 2 information pages × 1 pass | 288 | 開催数実測ではなく既存N0と同じ144 race設計例。poll追加ごとに同数増える |
| one-change-four-market-lags | per changed race | 5 market pages × 4 lag checkpoints (30s/1m/3m/5m) | 20 | 情報source再取得分を含まない。変更頻度が未測定なので日次総数はUNKNOWN |
| derived-research-ledgers | per rebuild | saved raw only | 0 | Error Atlas、strict-prior水面evidence、uncertainty/fragility計算は保存済みrawを再利用 |

### N1以降

- N1: 全券種払戻基盤のみ。独自研究軸のmodel/featureは実装しない。
- N2: 全券種oddsをbatch/skew付きappend-only観測。市場整合性modelは実装しない。
- N3: 公式情報change event、measurement quality、beforeinfo versioning。
- N4: strict-prior水面evidence、1マーク結果label、Error Atlas監査台帳。
- N5: 120状態raw projection auditと不確実性値。baseline/選択器は既存gate後。
- N6以降: 市場残差、SKIP、Fragility、因果・市場遅延研究は各gate通過後の別タスク。

今回、モデル、120状態baseline、SKIP予測器、Fragility Index、状態推定、券種選択器は実装していない。

## 展示・結果原因・事故

- pre-race weather races: 17,306
- post-race condition races: 1,190,385
- 両方があるraces: 10,010
- exhibition races: 17,206
- actual course races: 1,190,383
- actual ST races: 1,190,380
- status_code races: 77,094

現行beforeinfo parserは展示タイム、展示ST、チルト、プロペラ、部品交換、天候、風速、波高、気温、水温、安定板、周回短縮を扱う。公式画面の風向は画像で、現行parser/`race_weather`に保存されない。展示進入は`course`に畳み込まれており、枠・艇・展示コースの区別が弱い。結果archiveには実進入、実ST、着順、事故status、決まり手、結果時の風向があるが、事前特徴ではない。

## 売上・流動性

- 判定: **BLOCKED**
- 今回確認した公式race画面・日次成績archiveには券種別売上額/投票口数を確認できなかった。
- オッズ水準、overround、更新間の変化量、レンジ幅は市場状態proxy候補だが、売上・流動性の実測値とは呼ばない。
- proxyを使う場合も `metric_kind=proxy`、算出version、観測時刻、欠測理由を保存し、因果説明へ使わない。

## request budget

| scenario | races/day | checkpoints | pages/checkpoint | results/race | requests/day | 全日平均間隔 |
|---|---:|---:|---:|---:|---:|---:|
| result-only | 144 | 0 | 0 | 1 | 144 | 600.0秒 |
| all-markets-T-5-only | 144 | 1 | 5 | 1 | 864 | 100.0秒 |
| all-markets-4-checkpoints | 144 | 4 | 5 | 1 | 3,024 | 28.6秒 |

144 races/dayは安全側の設計例であり、開催数実測ではない。robots.txtは全面許可形式だが、サイトポリシーは大量アクセスを禁止する。robots許可を収集許可と同一視しない。N2ではrace単位の締切窓、ETag/Last-Modifiedの有無、同一checkpoint skip、global concurrency、host間隔、指数backoff、日次上限、kill switchを先に固定する。

## 公式根拠と制約

- 直前情報: https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=20260721&jcd=23&rno=1
- 結果（7券種払戻）: https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20260721&jcd=23&rno=1
- オッズ5画面: https://www.boatrace.jp/owpc/pc/race/oddstf?hd=20260721&jcd=23&rno=1 / https://www.boatrace.jp/owpc/pc/race/odds2tf?hd=20260721&jcd=23&rno=1 / https://www.boatrace.jp/owpc/pc/race/oddsk?hd=20260721&jcd=23&rno=1 / https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20260721&jcd=23&rno=1 / https://www.boatrace.jp/owpc/pc/race/odds3f?hd=20260721&jcd=23&rno=1
- robots.txt: https://www.boatrace.jp/robots.txt
- サイトポリシー: https://www.boatrace.jp/owpc/pc/extra/policy.html
- 更新仕様: https://www.boatrace.jp/owpc/pc/extra/about.html
- archive: data/raw/official/results/k260721.lzh のK260721.TXTに7券種の払戻行を確認（リポジトリ内既存cache、抽出物は未保存）。

公式仕様上、オッズ画面の更新は自動ではなく、締切時オッズも最終確定オッズではない。スタート事故等を反映したオッズも表示されない。したがって `observed odds`、`closing-like odds`、`official payout` を別のsource qualityで保存する。

## N1へ進める条件

- [ ] N0設計レビュー承認
- [ ] 7券種払戻fixtureで通常・複数的中/同着・返還・不成立・特払いを固定
- [ ] read-only dry-runでparser coverageとidempotency keyを確認
- [ ] 公式サイト方針に適合する低頻度canaryの人間承認
- [ ] migrationを別タスクとしてレビューし、backup/rollback手順を確定

Phase N0単体の判定では払戻基盤を最初のデータ実装候補とした。その後の統合設計により、全体順序は[`../docs/research-platform-master-plan.md`](../docs/research-platform-master-plan.md)を最上位正本とし、Stage F0「Research Replay Foundation」をN1より先に置く。N1の範囲自体は全券種払戻基盤のみで変えず、オッズ時系列、モデル、券種選択器を含めない。

## table inventory

| table | rows | races | range | source/provenance columns |
|---|---:|---:|---|---|
| app_settings | 1 | — | — | — |
| decision_history | 444,296 | 444,284 | 2018-01-01 .. 2026-07-23 | source, fetched_at |
| exhibition_data | 103,078 | 17,206 | 2026-05-30T01:41:24.819Z .. 2026-07-23T09:28:57.878Z | fetched_at, source_type, source_quality |
| historical_alternative_odds | 131,187 | 4,301 | 2024-01-01 .. 2026-05-20 | source_type, source_quality, source_url, fetched_at, parser_version, fetch_status |
| job_locks | 0 | — | — | — |
| job_runs | 27 | — | 2026-06-02 06:31:48 .. 2026-06-02 06:45:50 | — |
| manual_odds | 6,629 | 6,629 | — | source |
| missing_jobs | 14 | — | 2026-06-02 06:40:15 .. 2026-06-02 06:40:15 | — |
| motor_boat_stats | 685,523 | 114,356 | 2024-01-01 .. 2026-07-23 | imported_at |
| notification_log | 19 | 19 | 2026-05-21 07:23:22 .. 2026-07-23 02:19:37 | — |
| odds_snapshots | 1,801,933 | 277,124 | 2026-05-23T05:11:53.835Z .. 2026-07-23T09:40:12.018Z | source, captured_at |
| odds_timeseries_snapshots | 49,039,706 | 6,115 | 2026-06-01T09:15:19.284Z .. 2026-07-23T09:37:30.472Z | source, captured_at |
| official_programs | 1,145,194 | 1,145,194 | 2004-06-01 .. 2026-07-23 | source_file, imported_at |
| paper_roi_candidates | 696 | 543 | 2024-04-01 .. 2025-08-12 | — |
| push_subscriptions | 0 | — | — .. — | — |
| race_conditions | 1,190,385 | 1,190,385 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_entries | 7,132,052 | 1,190,383 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_equipment | 103,260 | 17,210 | 2026-06-01T03:26:48.714Z .. 2026-07-23T09:30:13.847Z | fetched_at, source_type, source_quality |
| race_payouts | 5,871,974 | 1,190,226 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_results | 1,177,477 | 1,177,477 | 2004-06-01 .. 2026-07-21 | source, fetched_at |
| race_weather | 17,306 | 17,306 | 2026-05-30T13:02:08.311Z .. 2026-07-23T09:30:13.847Z | fetched_at, source_type, source_quality |
| racer_course_stats | 9,840 | — | 2026-06-07T21:35:28.123Z .. 2026-07-13T08:40:09.424Z | fetched_at |
| racer_profiles | 2,660 | — | 2026-07-12T22:54:25.119Z .. 2026-07-19T20:05:27.355Z | fetched_at |

詳細な全column/index/CREATE SQLは `reports/all-bet-type-data-feasibility.json` の `schema` を参照。
