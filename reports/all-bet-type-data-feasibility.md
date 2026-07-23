# 全券種データ取得可能性・保存設計監査（Phase N0）

生成日時: 2026-07-23T08:37:01.689Z

> 読み取り専用監査。DB migration、実収集、予測ロジック、市場残差モデル、券種選択器、production接続は実施していない。

## 結論

- 7券種の公式払戻は、同一レースの公式結果ページと既存公式日次成績cacheで確認できた。
- 現DBの払戻はexacta / quinella / wide / trifecta / trioのみ。win / placeは公式ソースにあるが現行parserが保存していない。
- 全券種オッズは5つの公式画面に分かれる。現DBのlive timeseriesはbet_type列のない3連単専用で、他券種を安全に混在できない。
- range表示のplace / wide、同着・返還・不成立・特払い、欠場を明示的な状態として保存する必要がある。
- 全race×5画面×4 checkpointは負荷が大きい。サイトポリシーは大量アクセスを禁止しているため、低頻度canaryと運用承認なしに実収集へ進めない。
- 売上・投票口数の取得根拠は未確認。オッズ変化を流動性そのものと呼ばない。

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
- odds_timeseries_snapshots: 49,035,326 rows
- DB total_changes: before=0, after=0
- 監査CLIの外部request: 0
- 監査中DB file変化: なし

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
| T-10 | 24,095,520 | 2,226 | 6 .. 15 | 2026-06-01T09:15:19.284Z .. 2026-07-23T08:26:10.972Z |
| T-20 | 19,709,968 | 4,040 | 11 .. 25 | 2026-06-01T09:15:39.905Z .. 2026-07-23T08:26:11.414Z |
| T-30 | 453,418 | 3,673 | 21 .. 30 | 2026-06-01T09:15:30.661Z .. 2026-07-23T08:12:32.154Z |
| T-5 | 4,776,420 | 823 | 4 .. 10 | 2026-06-02T00:42:55.010Z .. 2026-07-23T08:26:01.989Z |

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

## 展示・結果原因・事故

- pre-race weather races: 17,297
- post-race condition races: 1,190,385
- 両方があるraces: 10,010
- exhibition races: 17,194
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
| decision_history | 444,284 | 444,272 | 2018-01-01 .. 2026-07-23 | source, fetched_at |
| exhibition_data | 103,007 | 17,194 | 2026-05-30T01:41:24.819Z .. 2026-07-23T08:22:28.541Z | fetched_at, source_type, source_quality |
| historical_alternative_odds | 131,187 | 4,301 | 2024-01-01 .. 2026-05-20 | source_type, source_quality, source_url, fetched_at, parser_version, fetch_status |
| job_locks | 0 | — | — | — |
| job_runs | 27 | — | 2026-06-02 06:31:48 .. 2026-06-02 06:45:50 | — |
| manual_odds | 6,617 | 6,617 | — | source |
| missing_jobs | 14 | — | 2026-06-02 06:40:15 .. 2026-06-02 06:40:15 | — |
| motor_boat_stats | 685,523 | 114,356 | 2024-01-01 .. 2026-07-23 | imported_at |
| notification_log | 19 | 19 | 2026-05-21 07:23:22 .. 2026-07-23 02:19:37 | — |
| odds_snapshots | 1,799,173 | 277,112 | 2026-05-23T05:11:53.835Z .. 2026-07-23T08:29:23.643Z | source, captured_at |
| odds_timeseries_snapshots | 49,035,326 | 6,103 | 2026-06-01T09:15:19.284Z .. 2026-07-23T08:26:11.414Z | source, captured_at |
| official_programs | 1,145,194 | 1,145,194 | 2004-06-01 .. 2026-07-23 | source_file, imported_at |
| paper_roi_candidates | 696 | 543 | 2024-04-01 .. 2025-08-12 | — |
| push_subscriptions | 0 | — | — .. — | — |
| race_conditions | 1,190,385 | 1,190,385 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_entries | 7,132,052 | 1,190,383 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_equipment | 103,206 | 17,201 | 2026-06-01T03:26:48.714Z .. 2026-07-23T08:22:49.049Z | fetched_at, source_type, source_quality |
| race_payouts | 5,871,974 | 1,190,226 | 2000-01-01 .. 2026-06-01 | source, fetched_at |
| race_results | 1,177,477 | 1,177,477 | 2004-06-01 .. 2026-07-21 | source, fetched_at |
| race_weather | 17,297 | 17,297 | 2026-05-30T13:02:08.311Z .. 2026-07-23T08:22:49.049Z | fetched_at, source_type, source_quality |
| racer_course_stats | 9,840 | — | 2026-06-07T21:35:28.123Z .. 2026-07-13T08:40:09.424Z | fetched_at |
| racer_profiles | 2,660 | — | 2026-07-12T22:54:25.119Z .. 2026-07-19T20:05:27.355Z | fetched_at |

詳細な全column/index/CREATE SQLは `reports/all-bet-type-data-feasibility.json` の `schema` を参照。
