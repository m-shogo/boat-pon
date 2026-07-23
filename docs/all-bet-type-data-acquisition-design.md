# 全データ取得可能性・保存設計（全券種＋選手PIT、Phase N0監査結果）

更新: 2026-07-23

この文書は取得可能性と安全な取得契約の設計書である。Phase N0ではDB migration、実収集、production接続を行わない。実測値は[`../reports/all-bet-type-data-feasibility.md`](../reports/all-bet-type-data-feasibility.md)、全schemaは同JSONを正本とする。

## 結論

- 公式結果ページと公式日次成績archiveには、単勝、複勝、2連単、2連複、拡連複、3連単、3連複の払戻がある。
- 現DBの`race_payouts`は単勝・複勝が0件。既存archiveに値はあるため、取得不能ではなく現行parserの欠落である。
- 公式オッズは5画面に分かれる。3連単以外を現行`odds_timeseries_snapshots`へ入れると、`bet_type`なしで同じselectionが衝突する。
- 複勝と拡連複はレンジ表示なので、単一`odds`列へ丸めない。
- 売上額・投票口数は今回の公式race画面とarchiveで確認できず、取得判定はBLOCKED。オッズ変化は流動性proxyにすぎない。
- 選手情報は、`official_programs.raw_json`にレース当時の級別・全国/当地勝率・2連率が残る一方、`racer_profiles`と`racer_course_stats`は現在値1世代で、過去レースへの直接JOINはpoint-in-time不適格である。
- `race_entries`からコース別成績、直近30/90走、ST分散、F後日数、過去同走・直接対戦、戦法proxyを対象レースより前だけで再構築できる。ただし、当時プロフィール、集計窓、標本数を持つsnapshotは未整備である。
- 払戻基盤をPhase N1、オッズ時系列をPhase N2として分離する。

## 公式source map

| 種別 | path / source | 内容 | N0判定 |
|---|---|---|---|
| 単勝・複勝odds | `oddstf` | 6艇、複勝はrange | CONDITIONAL |
| 2連単・2連複odds | `odds2tf` | 30 / 15通り | CONDITIONAL |
| 拡連複odds | `oddsk` | 15通り、range | CONDITIONAL |
| 3連単odds | `odds3t` | 120通り | GO（既存3連単経路のみ） |
| 3連複odds | `odds3f` | 20通り | CONDITIONAL |
| 払戻・結果 | `raceresult` | 7券種、着順、ST、返還、決まり手、結果時気象 | CONDITIONAL |
| 日次成績 | `data/raw/official/results/kYYMMDD.lzh`相当 | 7券種、実進入、実ST、事故、結果時気象 | CONDITIONAL |
| 直前情報 | `beforeinfo` | 展示、展示ST、装備、直前気象 | CONDITIONAL |

同一レースで確認したURLは監査レポートに固定した。`robots.txt`は`Disallow:`空だが、サイトポリシーは大量アクセスを禁止している。robotsの許可を収集許可と解釈しない。

## 券種とselection契約

| bet_type | 日本語 | 6艇時 | selection | odds |
|---|---|---:|---|---|
| `win` | 単勝 | 6 | 艇番号1桁 | point |
| `place` | 複勝 | 6 | 艇番号1桁 | range |
| `exacta` | 2連単 | 30 | 着順通り`1-2` | point |
| `quinella` | 2連複 | 15 | 昇順`1-2` | point |
| `wide` | 拡連複 | 15 | 昇順`1-2` | range |
| `trifecta` | 3連単 | 120 | 着順通り`1-2-3` | point |
| `trio` | 3連複 | 20 | 昇順`1-2-3` | point |

欠場時は固定6艇の期待数だけで完全性を決めない。`active_boats`と発売状態から期待selection集合を生成し、各selectionを`offered / scratched / unavailable`で保存する。画面空欄を0倍や欠場と推測しない。

## 時刻とpoint-in-time

次の時刻を混ぜない。

| field | 意味 |
|---|---|
| `scheduled_close_at` | 公式番組の締切予定 |
| `request_started_at` | HTTP開始 |
| `observed_at` | 応答を受け、その内容を観測できた時刻 |
| `source_published_at` | 画面に明示された更新時刻。日付またぎとtimezoneを解決できた場合のみ |
| `fetched_at` | cacheへ取得完了した時刻 |
| `confirmed_at` | 払戻が公式結果として確認された時刻 |

`checkpoint_label`は応答後の`observed_at`と`scheduled_close_at`から決める。要求開始前の時刻を保存しない。`source_published_at`が無いときはNULLにし、`observed_at`で代用したと偽装しない。

公式説明では締切時オッズは最終確定オッズではなく、スタート事故等を反映しない。したがって品質語彙を以下に分ける。

- `live_observed`: 締切前に観測した公開オッズ
- `closing_like`: 公式画面の締切時表示。最終確定とは呼ばない
- `historical_closing_odds`: 既存archiveの履歴終値
- `official_settlement`: 公式払戻

## 払戻状態

最低限、race×bet_type単位の状態と、0件以上のpayout lineを分ける。

| settlement_status | 意味 |
|---|---|
| `settled` | 通常または同着を含み、払戻lineが確定 |
| `refunded` | 当該券種が返還 |
| `cancelled` | レース中止・不成立 |
| `special_payout` | 特払い |
| `no_sale` | 発売なし |
| `pending` | 結果未確定 |
| `parse_error` | sourceは取得したが契約に合わない |

同着は`race returned`に畳み込まず、`result_kind=dead_heat`と複数payout lineで表す。複勝は通常でも複数line、拡連複は通常3 lineになるため、「複数line=同着」と推定しない。返還対象艇が分かる場合は別のrefund lineへ保存する。

Phase N1のfixture matrix:

1. 通常6艇
2. 複勝2 line、拡連複3 line
3. 同着で同一券種に複数的中組
4. フライング等の一部返還
5. 全返還
6. 中止・不成立
7. 特払い
8. 欠場・発売なし
9. 公式HTMLと日次成績の不一致
10. 未知の表示を`parse_error`へ隔離

## 直前情報と結果情報

### 事前利用可能

- 番組、締切予定
- 直前体重
- 展示タイム
- 展示進入と展示ST
- チルト、プロペラ、部品交換
- 直前の天候、風向、風速、波高、気温、水温、安定板、周回短縮

現行`beforeInfoParser`は風向を保存せず、`exhibition_data.course`に枠・艇・展示コースの意味が畳み込まれている。N3では`frame_no / boat_no / exhibition_course`を分離する。現在のlatest upsert値を時系列と見なさない。

### 結果後のみ

- 着順、race time
- 実進入
- 実ST、F/L等status
- 決まり手
- 結果時の天候・風向・風速・波高
- 払戻・返還

`race_conditions`と`race_entries`のこれらは結果原因ラベルであり、予測時特徴量へ入れない。`race_weather`との同名項目もsource phaseを必ず区別する。

## request budgetと負荷制御

144 races/dayを設計例にすると:

| scenario | requests/day | 全日平均間隔 |
|---|---:|---:|
| 結果のみ1 page/race | 144 | 600.0秒 |
| 5 odds画面をT-5のみ＋結果 | 864 | 100.0秒 |
| 5 odds画面を4 checkpoint＋結果 | 3,024 | 28.6秒 |

これは全日平均で、実際は締切前へ集中する。したがって4 checkpoint全券種を初期GOにしない。

N1/N2で必要な制御:

- 同一URL、同一race、同一checkpointの成功cacheは再要求しない
- host全体の最小間隔と同時数を設定値として固定
- 429/403/5xxは指数backoffし、無制限retryしない
- race、日次、host別request上限を持つ
- timeout、User-Agent、parser version、HTTP statusを記録
- response構造変化率とparse error率でkill switch
- current collectorの頻度・launchdは別の明示承認なしに変更しない
- canaryは少数race、単一checkpoint、dry-run保存先から始める

サイトポリシー適合性と運用負荷は人間の承認事項である。技術的に閲覧できることだけで継続収集をGOにしない。

## 売上・流動性proxy

公式の券種別売上額・投票口数はN0で確認できなかったためBLOCKED。

将来使える可能性があるproxy:

- oddsのoverround
- checkpoint間のimplied probability変化
- popularity順位変化
- range oddsの幅
- selection別の更新有無

保存時は`metric_kind=proxy`、算出version、入力observation ID、欠測理由を持つ。売上、投票額、資金流入、参加者数と表現しない。

## 選手情報・point-in-time設計

詳細な実測値と項目別判定は監査レポートの「選手情報・point-in-time特徴量監査」とmachine-readable JSONの`racerAudit`を正本とする。項目別判定は`GO / CONDITIONAL / BLOCKED / UNKNOWN`で表し、取得可否と予測利用可否を混同しない。

### 正本と責務

| source | 正本としての責務 | historical利用 |
|---|---|---|
| `official_programs.raw_json` | レース日・raceごとの番組原文。登録番号、当時級別、全国/当地勝率・2連率 | GO。保存済みrawをそのまま参照し、現在値で補完しない |
| `race_entries` | 公式結果由来の登録番号、実進入、実ST、着順、事故code | GO。ただし対象raceより前だけを集計する |
| `data/raw/kyotei24/odds` | 保存済みレース前HTML。年齢、支部、性別、体重等の原文候補 | CONDITIONAL。観測時刻、対象race、parser versionを確定してから利用 |
| `racer_profiles` | live用の最新選手集計1世代 | historicalへはBLOCKED。`fetched_at`は値の有効時点ではない |
| `racer_course_stats` | live用の最新コース集計1世代 | historicalへはBLOCKED。集計期間・標本数が不足し、`races`は実測上すべて0 |
| `decision_history`内の選手特徴 | 過去の判定監査出力 | 正本にしない。元sourceとfeature versionが追跡できる場合だけ再現性検査に使う |
| strict-prior再構成処理 | recent/course/pair/style派生値 | raw結果を正本にし、materializeは再計算可能なcacheに限定 |

現在プロフィールが`official_programs.raw_json`を上書きした証拠はない。ただし、現在値tableを過去raceへJOINすれば、級別変更、F/L、能力集計、体重等に未来情報が混入する。historical queryでは既存のlive-only feature除外guardを維持する。

### 現在すでに使える情報

- 2004-06-01以降の番組rawにある登録番号、当時級別、全国/当地勝率・2連率
- 2000-01-01以降の`race_entries`にある登録番号、実進入、実ST、着順、事故code
- 保存済みレース前HTML範囲の年齢、支部、性別、体重。ただしraceとの対応・観測時刻を固定するparserが必要
- strict-prior event順で再構築するコース別標本、直近30/90走、ST平均・分散、F後日数、開催内前走、過去同走、直接対戦

### point-in-time不適格または新規取得が必要な情報

- `racer_profiles` / `racer_course_stats`を過去raceへ直接JOINすること
- 現在プロフィールで過去の級別、支部、年齢、体重、F/Lを補完すること
- 全国/当地3連率、事故率、登録期、能力値の対象期間が確認できないまま利用すること
- コース別の標本数、集計期間、ST標準偏差、F率、大幅遅れ率、当地×コース成績を現在tableだけで復元すること
- 公式資料で確認できる師弟関係の完全な履歴。確認済み公開資料と公開日以前のraceだけに限定し、欠測を推測しない
- 部品交換後変化と展示当日推移。append-onlyの`beforeinfo`観測が必要

### strict-prior再構築契約

対象raceを`target`、入力結果を`source`とすると、最低条件は`source.event_at < target.event_at`である。日付だけで比較せず、同日はrace順・締切時刻で厳格に先行させる。対象raceの着順、ST、決まり手、事故および対象race後の結果を入力に含めない。

再構築可能な派生値:

- 選手×1〜6コースの出走数、1/2/3着率、ST平均・分散、F率、大幅遅れ率
- 逃げ・差し・まくり・まくり差しへの関与、1着を逃した後の2/3着残り率、進入変更時成績
- 直近30/90走、直近ST平均・分散、F後経過日数、開催内前走着順/ST、同日何走目、前走間隔
- 過去同走、直接対戦、隣接コース対戦、同開催再戦、1号艇敗戦時の2着残り、攻め連動proxy

戦法・相互作用は公式結果から機械的に再現できるproxyに限る。「攻めたから隣艇が落ちた」のような因果や、私的人間関係、不正推測、個人名別ROIは保存・利用しない。

### snapshotと集計窓

- `fetched_at`: cacheへの取得完了時刻
- `observed_at`: 値を観測できた時刻
- `as_of_date`: その値・集計を利用可能とする基準日
- `effective_from / effective_to`: 級別等の有効期間
- `period_start / period_end`: 勝率・ST等の集計対象期間
- `source_max_event_at`: 派生値へ含めた最も新しい入力event

これらを代用し合わない。率だけでなく、標本数、可能ならcount・sum・sum of squaresを保存し、平均・分散・標準偏差を再計算可能にする。集計窓が不明な公開値は`period_kind=source_defined_unknown`として隔離し、自作の30/90走値と同一視しない。

欠測はNULLと`missing_reason`で表し、0、平均、現在値で埋めない。historical backfillとlive観測は`build_mode`で分離し、同じraw fingerprint、parser version、feature version、window definitionから同じ値を再生成できることを要求する。

## 選手情報のPhase割当

| Phase | 範囲 |
|---|---|
| N1 | 変更なし。全券種払戻基盤だけ。選手特徴をBUY/WATCH/SKIPへ追加しない |
| N2 | 変更なし。全券種オッズ時系列だけ。選手特徴を混ぜない |
| N3 | profile/period/course-period snapshot、支部・登録期・年齢・性別・直前体重、展示・部品交換のappend-only観測 |
| N4 | `race_entries`等からstrict-prior recent form、コース、pair、style proxyを再構築し、外れ原因ラベルと分離 |

M1の「市場offset＋選手・枠・モーター」はN3/N4のPIT品質gateを通過するまで開始しない。M3の「1マーク展開・相互作用」はstrict-prior再構築と因果でないproxy表現が固定されるまで開始しない。

## 独自研究軸のデータ前提

項目別判定とmachine-readable契約は監査JSONの`researchAxisAudit`を正本とする。7軸はいずれも現状`CONDITIONAL`であり、研究modelの実装許可を意味しない。

| 研究軸 | 現在データ | 過去再構築 | future-only | 保存Phase | 追加request |
|---|---|---|---|---|---|
| 公式情報の市場反映遅延 | latest情報＋3連単checkpointのみ | 値は部分可、lag不可 | 必須 | N2/N3 | 変更1件×4 lagで5画面×4=20 request。変更頻度はUNKNOWN |
| 全券種市場整合性 | 3連単のみ | 全券種同時点は不可 | 必須 | N2→N5 | 1 checkpoint 5画面 |
| 1マーク因果graph | 結果rawは広範囲、展示は部分 | 共起proxyまで可 | 完全な展示PITは必須 | N3/N4→M3 | 上流観測再利用なら0 |
| 選択的予測 | 標本数・品質の一部 | 一部entropyのみ | 完全な欠損mask/市場不一致は必須 | N5以降 | 上流再利用で0 |
| Fragility | 値のみ、精度metadata不足 | raw cache範囲は部分可 | late update較正は必須 | N2/N3→N5 | 同一response保存なら0 |
| 潜在水面状態 | 長期結果＋直近pre-race | strict-priorで部分可 | 完全な市場期待・風向は必須 | N4→N5 | 上流再利用で0 |
| Error Atlas | 現行paper/結果で部分可 | 着順・集合/順序・事故は可 | 全券種価格層は必須 | N4→N8 | 上流再利用で0 |

特に有望なのは、既存候補を構造分類できるError Atlas、長期結果をstrict-priorで再利用できる潜在水面状態evidence、全軸共通の品質基盤になる選択的不確実性である。これは優先研究候補の監査判断であり、今回modelを作るという意味ではない。

### 公式情報change event

出走表、欠場、展示進入/ST/time、チルト、部品交換、風向/風速/波高、安定板、周回短縮、締切変更を共通のversioned observationとして扱う。

最低field:

- `source_published_at`: source自身が明示した公開/更新時刻。無ければNULL
- `source_observed_at`: 応答内容を観測できた時刻
- `first_seen_at`: そのversionを初めて観測した時刻
- `changed_at`: source時刻が確定する場合はその時刻、不明ならNULL
- `previous_raw_hash / current_raw_hash`
- `change_type / change_payload`
- `source_version`
- `timing_quality`

現行`official_programs`、`race_weather`、`exhibition_data`、`race_equipment`はrace keyのlatest 1世代であり、変更履歴を表せない。`fetched_at / imported_at`は取得・取込時刻で、公開時刻ではない。

公式の[サイト説明](https://www.boatrace.jp/owpc/pc/extra/about.html)は、翌日出走表の表示開始を通常18時頃・サマー20時頃・ナイター22時頃とするが、これはrace/versionごとの正確な公開時刻ではない。直前情報画面の水面気象には「11R時点」のようなrace相対markerがある一方、壁時計の更新時刻ではない。オッズは公式説明上「オッズ更新時間」を参照する仕様なので、将来parserは表示の有無・値・timezone解決結果を券種とmarket状態ごとに保存し、HTTP観測時刻と分離する。

source時刻が無い場合、真の変更時刻は「前回観測後から`first_seen_at`まで」の区間である。`first_seen_at`を公開時刻と断定せず、`timing_quality=first_seen_bound`と前回観測時刻を保存する。30秒、1分、3分、5分反応は、その境界以後に観測したmarketだけを使う。

### market observation batchと120状態

5画面を取得してもHTTP応答は同時ではない。`market_observation_batch_id`を共通にし、各画面の`request_started_at / observed_at`と、batchの`min_observed_at / max_observed_at / skew_ms`を保存する。skewが許容値を超えたbatchを「同時点市場」と呼ばない。

raw marketの責務:

- 全selectionと`offered / scratched / unavailable / unknown`
- point oddsまたはsource表示のrange
- 返還・同着・発売なし
- source raw hash、parser version、観測時刻
- 券種別控除率の根拠source・適用期間。未確認はNULL
- 券種ごとのsource qualityと更新有無

上位3着120状態へのprojectionは派生監査値である。raw evidenceを正本にし、券種間の矛盾や時刻ずれをprojectionで上書きしない。複勝・拡連複のrangeをmidpointへ確定変換しない。券種ごとの制約残差、観測skew、利用したraw observation ID、projection versionを残す。

### 1マークgraphの事前・事後境界

| 項目 | 役割 |
|---|---|
| 展示進入、展示ST、展示time、strict-priorコース別ST分布 | レース前特徴候補 |
| 実進入、実ST、決まり手、着順、事故、結果確定状態 | 結果後の教師・監査label |
| 1号艇の2/3着残り、隣接艇順位、外艇上位 | 公式結果から作るpost-race共起proxy |
| 攻撃艇、隣接艇を潰した | 公式telemetryが無いため判定不能 |

勝者を攻撃艇とみなさず、決まり手から艇間因果を後付けしない。pre-race feature tableとpost-race label tableを分け、同じquality codeへ混在させない。

### 選択的不確実性

将来の不確実性snapshotは、120状態集中度、1着entropy、上位2/3艇集合entropy、順序entropy、類似race数、選手×course標本数、入力欠損、券種間不一致、odds変動性、進入不確実性、ST分散、PIT品質、鮮度を対象とする。

各値に`as_of_at / sample_count / missing_reason / source_quality / feature_version`を付ける。結果後に定義した「予測可能だったか」はaudit labelであり、candidate生成時のinputへ戻さない。SKIP model、conformal prediction、券種選択は今回実装しない。

### measurement qualityとFragility前提

展示ST/time、風速・風向・波高、進入、選手snapshot、motor成績、odds、締切残時間について次を観測rowへ持たせる。

- `measurement_quality`
- `value_precision`
- `value_min / value_max`
- `source_disagreement`
- `late_update_possible`
- `confidence`
- raw表示文字列とsource hash

表示丸め以上の精度を生成しない。摂動範囲は当該`observed_at`で既知だったprecision/range/source差だけから作る。将来判明した更新幅を過去へ適用しない。

### 潜在水面状態のstrict-prior evidence

状態modelではなく、対象race前に利用可能なevidence台帳を設計する。

- race時刻・当日順
- 1コース市場期待と実績の残差
- 外艇上位、ST平均/分散、風向/風速/波高
- 決まり手、事故、実進入、安定板、周回短縮

`source_max_event_at < target_event_at`を必須とする。高配当だけを荒れと呼ばず、会場・季節baseline、evidence count、effective sample size、縮小先を保存する。少数raceで確定状態にせず、既存の手動「水面ムード」条件とは別namespace/versionにする。

### Error Atlas

Error Atlasはcandidate時点のmanifestとinput fingerprintを凍結し、結果後に以下を分類する研究台帳である。

- 1/2/3着誤り
- 上位2/3艇集合は正解・順序のみ誤り
- 単勝・複勝・2連単・2連複・3連複なら的中
- T-5価値あり→final-like価値消失
- 進入変化、ST異常、事故/F/L
- 入力欠損、PIT不適格
- 市場もmodelも誤り、市場は正しくmodelだけ誤り

結果を見てBUY条件を変更する探索器にしない。データ層・市場層・model層の失敗を分離する監査labelとしてのみ扱う。final-likeが無い場合、払戻からfinal oddsを推定しない。

## 拡張source-quality taxonomy

| code | 意味 |
|---|---|
| `source_timestamp_exact` | source自身の公開/更新時刻がtimezone込みで確定 |
| `observed_time_only` | source時刻なし。観測時刻のみ |
| `first_seen_bound` | poll間で初めて変化を観測。公開時刻は区間 |
| `versioned_raw_exact` | current/previous raw hash付きappend-only観測 |
| `rounded_display` | 表示丸め単位付きpoint値 |
| `range_display` | source表示min/max |
| `derived_strict_prior` | 対象eventより前だけから再構築 |
| `post_race_label` | 結果後の教師/監査label |
| `timing_ambiguous` | source日付・timezone・更新時刻を一意化不能 |

欠測理由は少なくとも`not_published / not_observed / not_offered / parse_error / point_in_time_ineligible / stale / timing_ambiguous`を分ける。

## 独自研究軸のPhase割当

| Phase | 保存範囲 |
|---|---|
| N1 | 払戻のみ。研究model・featureを追加しない |
| N2 | 全券種market batch、各response時刻、raw contradiction |
| N3 | 公式情報change event、measurement quality、beforeinfo versioning |
| N4 | strict-prior水面evidence、1マーク結果label、Error Atlas |
| N5 | 120状態projection監査値、不確実性snapshot。既存gate前にbaselineを開始しない |
| N6以降 | 市場残差、SKIP、Fragility、因果、反映遅延研究は別タスク・別gate |

## Phase N1の範囲

Phase N1で実装してよいのは全券種払戻基盤だけ。

- fixtureとparser
- settlement/payout/refundの保存
- read-only dry-run
- idempotency
- 小規模canary
- coverage report

オッズ時系列、既存collector変更、予測ロジック、市場残差モデル、券種選択器、production接続はPhase N1に含めない。
