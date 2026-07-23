# 全データ取得可能性・保存設計監査（全券種＋選手PIT、Phase N0）

生成日時: 2026-07-23T09:11:56.309Z

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
- odds_timeseries_snapshots: 49,037,546 rows
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
| T-10 | 24,096,180 | 2,232 | 6 .. 15 | 2026-06-01T09:15:19.284Z .. 2026-07-23T09:06:38.481Z |
| T-20 | 19,710,748 | 4,047 | 11 .. 25 | 2026-06-01T09:15:39.905Z .. 2026-07-23T09:06:47.338Z |
| T-30 | 453,898 | 3,677 | 21 .. 30 | 2026-06-01T09:15:30.661Z .. 2026-07-23T09:06:46.997Z |
| T-5 | 4,777,200 | 830 | 1 .. 10 | 2026-06-02T00:42:55.010Z .. 2026-07-23T09:06:37.624Z |

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
| 公式結果archive | 8,163 files | — | 2000-01-01 .. 2026-07-21 | 結果由来rollingを再計算可能 |
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

## 展示・結果原因・事故

- pre-race weather races: 17,301
- post-race condition races: 1,190,385
- 両方があるraces: 10,010
- exhibition races: 17,201
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

Phase N0の判定は、払戻基盤を最初の独立実装候補とすること。オッズ時系列、モデル、券種選択器はN1に含めない。

## table inventory

| table | rows | races | range | source/provenance columns |
|---|---:|---:|---|---|
| app_settings | 1 | — | — | — |
| decision_history | 444,291 | 444,279 | 2018-01-01 .. 2026-07-23 | source, fetched_at |
| exhibition_data | 103,048 | 17,201 | 2026-05-30T01:41:24.819Z .. 2026-07-23T08:55:12.638Z | fetched_at, source_type, source_quality |
| historical_alternative_odds | 131,187 | 4,301 | 2024-01-01 .. 2026-05-20 | source_type, source_quality, source_url, fetched_at, parser_version, fetch_status |
| job_locks | 0 | — | — | — |
| job_runs | 27 | — | 2026-06-02 06:31:48 .. 2026-06-02 06:45:50 | — |
| manual_odds | 6,624 | 6,624 | — | source |
| missing_jobs | 14 | — | 2026-06-02 06:40:15 .. 2026-06-02 06:40:15 | — |
| motor_boat_stats | 685,523 | 114,356 | 2024-01-01 .. 2026-07-23 | imported_at |
| notification_log | 19 | 19 | 2026-05-21 07:23:22 .. 2026-07-23 02:19:37 | — |
| odds_snapshots | 1,800,733 | 277,119 | 2026-05-23T05:11:53.835Z .. 2026-07-23T09:00:22.061Z | source, captured_at |
| odds_timeseries_snapshots | 49,037,546 | 6,110 | 2026-06-01T09:15:19.284Z .. 2026-07-23T08:59:49.724Z | source, captured_at |
| official_programs | 1,145,194 | 1,145,194 | 2004-06-01 .. 2026-07-23 | source_file, imported_at |
| paper_roi_candidates | 696 | 543 | 2024-04-01 .. 2025-08-12 | — |
| push_subscriptions | 0 | — | — .. — | — |
| race_conditions | 1,190,385 | 1,190,385 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_entries | 7,132,052 | 1,190,383 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_equipment | 103,230 | 17,205 | 2026-06-01T03:26:48.714Z .. 2026-07-23T08:55:28.214Z | fetched_at, source_type, source_quality |
| race_payouts | 5,871,974 | 1,190,226 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_results | 1,177,477 | 1,177,477 | 2004-06-01 .. 2026-07-21 | source, fetched_at |
| race_weather | 17,301 | 17,301 | 2026-05-30T13:02:08.311Z .. 2026-07-23T08:55:28.214Z | fetched_at, source_type, source_quality |
| racer_course_stats | 9,840 | — | 2026-06-07T21:35:28.123Z .. 2026-07-13T08:40:09.424Z | fetched_at |
| racer_profiles | 2,660 | — | 2026-07-12T22:54:25.119Z .. 2026-07-19T20:05:27.355Z | fetched_at |

詳細な全column/index/CREATE SQLは `reports/all-bet-type-data-feasibility.json` の `schema` を参照。
