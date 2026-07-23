# boat-pon 研究再現基盤・市場知能マスタープラン

最終更新: 2026-07-23

## 1. 正本としての位置づけ

本書は、Phase N0完了後の研究アイデア、選手情報point-in-time監査、全券種市場構想、実装順序、評価系列の分離を統合した最上位の正本である。個別の取得・schema・モデル設計は既存文書を詳細正本として残し、順序や境界が競合した場合は本書を優先する。

- 研究アイデアの機械可読正本: [`research-idea-register.json`](research-idea-register.json)
- N0実測: [`../reports/all-bet-type-data-feasibility.md`](../reports/all-bet-type-data-feasibility.md)
- 取得設計: [`all-bet-type-data-acquisition-design.md`](all-bet-type-data-acquisition-design.md)
- schema案: [`all-bet-type-schema-migration-design.md`](all-bet-type-schema-migration-design.md)
- 市場モデル詳細: [`market-residual-ticket-selection-roadmap.md`](market-residual-ticket-selection-roadmap.md)
- 現在地: [`current-ai-handoff.md`](current-ai-handoff.md)

Phase N0は完了している。次の独立実装タスクはStage F0「Research Replay Foundation」であり、Phase N1ではない。本タスクでは文書だけを確定し、F0、F0-R、N1、DB migration、収集、モデル、production接続を実装しない。

## 2. 現在の確定状態

- 現行T-5 formal settledの蓄積は固定条件のまま継続する。
- 事前校正の混合係数は`alpha=0`であり、履歴モデルを市場確率へ混ぜない。
- 現行の昇格gateはすべて`BLOCKED`である。
- Phase N0は全券種、選手PIT、独自研究7軸を含めて完了した。
- 新研究方式はN7・N8の独立gateを通過するまでshadow専用である。
- production、自動購入、BUY/WATCH/SKIP条件変更は許可されていない。

## 3. 二つの評価系列を混ぜない

### 3.1 識別契約

| 項目 | 現行benchmark | 新研究方式 |
|---|---|---|
| `decision_system` | `legacy_t5_formal` | `market_intelligence` |
| `strategy_version` | `legacy-t5-v1` | versioned |
| `evaluation_mode` | `formal_forward` | `shadow_forward` |
| cohort | 現在の固定formal cohort | versioned fixed `cohort_id` |
| 運用 | 現行BUY/WATCH/SKIP、通知、gateを維持 | N7・N8通過までshadowのみ |
| production | 固定benchmarkとして存続 | N8後の独立production gateまで禁止 |

同じraceに複数方式のdecisionを保存できる設計にする。将来のdecision・paper evaluationは最低限、`decision_system`、`strategy_version`、`model_version`、`feature_version`、`manifest_id`、`cohort_id`、`evaluation_mode`、`ticket_type`、`selection`、`decision`を持つ。evaluation resultはこれに`evaluation_protocol_id`とresult versionを加える。設計上の一意性は、race identityにこれらの評価識別子を加えた複合キーで確保する。

### 3.2 共有する公式事実層

- race identity
- official raw data
- versioned observations
- racer snapshots
- weather、exhibition、equipment
- odds、payouts
- source quality
- point-in-time metadata

この層は「何が、いつ、どのsourceから観測されたか」の正本であり、方式ごとに複製しない。

### 3.3 必ず分離する評価層

- manifests、feature sets、model versions、strategies
- decisions、ticket selections、paper tickets
- cohorts、ROI、gates、reports

Legacyのdecisionや払戻を新方式で再ラベルせず、新方式の候補・払戻・成績をLegacy formal ROIへ混ぜない。

### 3.4 評価と報告の分離

別々に算出する:

- Legacy formal ROI
- Market-only baseline ROI
- New shadow ROI
- 券種別shadow ROI
- 各方式独立のselected-race ROI
- 同一common cohort上の比較ROI
- 最大1・2的中除外ROI
- CLV、logloss、Brier、calibration、coverage、SKIP率

「各方式が独自に選んだraceでの運用成績」と「同一common cohortでのモデル比較」は別レポート・別分母にする。比較不能な母集団を一つのROIに畳み込まない。最終判断を一つにまとめるDecision GovernorはN7以降の別設計であり、F0では実装しない。

## 4. アーキテクチャ原則

1. **再生してから予測する。** 任意の`as_of`で、当時観測可能だったraw、観測、特徴、候補を再構成できない限りモデルへ進まない。
2. **source時刻と観測時刻を分ける。** `fetched_at`を公開時刻に代用しない。
3. **rawとobservationとfeatureを分ける。** content-addressed rawは同一内容をdedupし、観測イベントは失わない。
4. **strict-priorを機械的に強制する。** 対象race、対象race後、未来timestampを入力へ含めない。
5. **不確実性を値と同格に保存する。** 標本数、窓、欠損理由、precision、source quality、freshnessを保持する。
6. **主観をlabelにしない。** 「攻撃艇」「隣接艇を潰した」等は公式値から一意に定義できない限り因果labelにしない。
7. **研究失敗を消さない。** Error AtlasはBUY条件探索ではなく、データ層・市場層・モデル層の失敗台帳にする。
8. **fixed cohortを先に凍結する。** adaptive observationや条件選択は固定cohort評価の後に限定する。

## 5. 研究再現基盤の破綻防止契約

### 5.1 五層の証拠モデル

Research Replay Foundationは次の五層を別entityとして扱う。

1. `capture_attempt`: HTTP request/responseを試みた取得事実。成功・失敗・status・request時刻・response時刻を保持する。
2. `raw_document`: 受信したbyte-exactな原文。`raw_sha256`でcontent-addressedに保存する。
3. `parse_run`: 一つのrawを特定`parser_version`で解析した実行。成功、失敗、warningを含む。
4. `domain_observation`: odds、weather、exhibition、racer、result等の型付き・versioned業務観測。
5. `race_asof_manifest`: 判断時点のversioned resolverが実際に採用したdomain observation集合と不足・拒否結果。

HTTP取得とparse結果を同じrowへ畳み込まない。parser更新で過去observationをUPDATEしない。同じrawの再解析は新しい`parse_run`と新しいobservationを作り、HTTP再取得には数えない。rawとtyped observationは互いの代用品ではない。

### 5.2 raw hashとsemantic hash

- `raw_sha256`: 受信bytesそのもののSHA-256。
- `semantic_payload_hash`: 対象意味データをcanonical化したhash。

公式情報change eventとEvent-Triggered Burstは原則`semantic_payload_hash`の変更で発火する。広告、token、生成時刻、装飾だけの変更をeventにしない。semantic hashは`parser_version`、`canonicalization_version`、`payload_type`、`source_schema_version`と一体で解釈する。

### 5.3 Canonical Identity

最低限、canonical race key、source別race alias、venue code、race date、race no、racer registration no、bet type、canonical selection、observation ID、capture attempt ID、raw document ID、parse run ID、decision ID、cohort ID、evaluation protocol IDを定義する。

source固有文字列だけでraceをJOINしない。欠場、中止、締切変更、日付跨ぎでもcanonical race identityを変更せず、状態とversionを別に保存する。

### 5.4 締切変更とcheckpoint凍結

各market observationは`scheduled_close_observation_id`、`scheduled_close_at_seen`、`observed_at`、`minutes_before_close_at_capture`、`checkpoint_label_at_capture`、`checkpoint_policy_version`を持つ。T-30/T-20/T-10/T-5 labelを後日の最新締切時刻で再計算しない。再生時も当時観測済みの締切versionだけを使う。

### 5.5 Versioned As-of Resolution Policy

Manifest builderの採用規則を`asof_resolution_policy_version`としてversion化する。observation typeごとのrequired/optional、source priority、最大staleness、source時刻不明、同時刻tie-break、parse error fallback、fixture除外、post-race除外、historical closing除外、current racer profile除外、missing処理を明記する。unknown observation typeはdefault denyとする。

同じraw/observation集合でもresolver policyが変われば別manifest version・別manifest hashを作り、既存manifestを上書きしない。

### 5.6 Manifest Completeness

Manifestは採用品だけでなく期待したinput typeごとに`found`、`missing`、`stale`、`rejected`、`not_published`、`not_observed`、`not_offered`、`parse_error`、`timing_ambiguous`、`point_in_time_ineligible`を保持する。さらにsearched source、searched time range、rejection reasonを保存する。

「観測がない」と「公式に存在しない」を同一視しない。strict manifestはrequired inputを暗黙補完せず、品質flagを付けるか生成を拒否する。

### 5.7 Append-only、訂正、supersession

raw document、capture attempt、parse run、domain observation、manifest、cohort manifest、evaluation resultはappend-only evidenceとする。公式訂正、parser修正、source修正はUPDATEで置換せず、`supersedes_id`、`superseded_by_id`、`correction_kind`、`correction_reason`、`recorded_at`、`effective_at`を持つ新versionを作る。

既存manifestは当時参照した旧observationを保持し、「当時版」と「最新訂正版」を分離する。manifestから参照されたraw/parse/observationはGC禁止。研究証拠を消し得る`ON DELETE CASCADE`は原則使わず、`RESTRICT`または明示的tombstoneを使う。

### 5.8 Evidence Retention / GC

保存契約はmanifest pin、cohort pin、evaluation pin、raw/parsed artifact retention class、unreferenced artifact GC、tombstone、orphan検査、disk low-water mark、storage quota、GC dry-run、GC audit logを持つ。一度研究結果へ使った証拠は容量対策で削除しない。

### 5.9 Frozen Cohort Manifest

cohortを動的SQLだけで再生成しない。`cohort_id`、`cohort_version`、`race_id`、`included`、`inclusion_reason`、`exclusion_reason`、`frozen_at`、`data_available_at_freeze`、`cohort_definition_version`を凍結する。後からdataが揃ったraceを同じversionへ黙って追加せず、新cohort versionを作る。

Legacy formal、market-only、new shadowのcommon-cohort比較も固定membershipを正本とする。

### 5.10 Evaluation Protocol

decision、cohort、評価規約を分離する。`evaluation_protocol_id`はstake、price source、checkpoint、closing-like、settlement、refund、dead-heat、no-sale、missing-data、ROI、CLV、logloss/Brier/calibration、最大1/2的中除外、bootstrap block、coverage、SKIP処理の各policy/versionを固定する。

同じdecisionを別protocolで評価した場合は別evaluation resultをappendし、規則変更で過去ROIを上書きしない。

### 5.11 F0 DB隔離とF0-R rollout

Stage F0は`data/boat.sqlite`をread-only sourceとしてのみ参照する。vertical sliceはtemp DB、安全なcopy、またはsidecar research DBで行い、既定候補を`data/research-replay.sqlite`とする。F0で稼働DB migrationを適用しない。

実DBまたはlive環境へのrolloutは別Stage `F0-R: Research Replay Foundation Rollout`とする。F0-Rでもsidecarを第一候補とし、`data/boat.sqlite`変更は別の明示承認なしに行わない。

### 5.12 Shadow write failure isolation

将来の接続では現行collectorをprimary、research writeをoptional shadowとする。research失敗でcollectorを失敗させず、同一transactionへ入れない。bounded queue、retry上限、backpressure、disk/research-writer kill switch、idempotency、replay可能outboxまたはcapture log、shadow health reportを持つ。F0ではlive collector接続を実装しない。

### 5.13 Deterministic canonical hash

Manifest hashとsemantic hashのcanonical化はversion化し、sorted key、決定的array順、UTF-8、UTC canonical time、元timezone、固定timestamp精度、固定float encoding、NULL/missing分離、`-0 / 0 / 0.0`規則、locale非依存、range順序、canonical selectionを定義する。

Manifest rootはgit commit SHA、DB schema version、manifest version、as-of resolver version、parser version set、feature version、taxonomy version、canonicalization version、source snapshot ID、timezone policy versionを含む。Mac、CI、別実行環境で同じ入力から同じhashになることをF0 gateにする。

### 5.14 Schema compatibility

schema migration ledger、migration checksum、minimum reader/writer version、expand-only migration、old reader compatibility、new writer feature flag、shadow write default OFF、unknown schema default deny、中断migration再開、partial migration検知を契約化する。

### 5.15 N5前の実験固定

D1開始前までにfrozen cohort、evaluation protocol、Error Atlas taxonomy pinを実装する。N5開始前までにexperiment protocol manifest、fixed split manifest、metric version freeze、multiple-testing registryを完成させる。

## 6. 実装順序

順序は次で固定する。

`Stage 0 → F0 → F0-R → N1 → D1 → N2 → N3 → N4 → D2 → E1 → E2 → N5 → N6 → N7 → N8`

途中stageを飛ばさない。各stageの完了はコードの存在ではなく、証拠artifactとcompletion gateで判定する。

### Stage 0: N0 Audit Closure

- 開始gate: N0のread-only監査結果が再実行可能。
- 入力: N0 report/json、取得設計、schema設計、選手PIT・独自研究軸監査。
- scope: 監査結果、用語、GO/CONDITIONAL/BLOCKED、request costの凍結。
- non-goals: migration、収集、特徴生成、モデル。
- tests: JSON parse、監査CLI read-only、文書リンク。
- evidence: N0 Markdown/JSONと関連設計文書。
- 完了gate: N0の未確定事項が`UNKNOWN`またはfuture-onlyとして明記される。
- rollback: 文書差分を戻し、N0実測値は変更しない。
- 次stage: F0。
- production eligibility: なし。

### Stage F0: Research Replay Foundation

- 開始gate: Stage 0完了、Legacy formalの不変条件と新方式識別契約が承認済み。
- 入力: official raw/cache、canonical identity map、N0のPIT/source-quality設計、read-onlyの`data/boat.sqlite`。
- scope: capture/raw/parse/domain/manifest五層、raw/semantic hash、canonical identity、checkpoint凍結、versioned as-of resolver、manifest completeness、append-only/supersession、retention pin、deterministic hash、schema compatibility、PIT/leakage guard、temp/sidecar DB vertical slice。
- non-goals: `data/boat.sqlite`変更、N1払戻migration、live collector接続、shadow write、収集job、モデル、Error Atlas本体、Decision Governor、BUY条件変更。
- tests: 五層lineage、raw再parse、semantic-only change、checkpoint freeze、completeness status、supersession、pin/GC、manifest hash決定性、時刻境界、parser/feature version、unknown schema、Legacy回帰。
- evidence: temp/sidecar replay conformance report、fixture manifest、lineage audit、hash cross-environment report、GC dry-run、schema compatibility report。
- 完了gate:
  - capture attempt、raw document、parse run、domain observation、manifestが別entityでlineage接続される。
  - 同じrawを新parserで再解析しても旧parse/observationが残る。
  - raw hashとversioned semantic hashを分離し、無関係なHTML差分でchange eventを発火しない。
  - canonical identityだけでsource aliasを統合し、状態変更でrace keyを変えない。
  - checkpoint labelをcapture時点で凍結し、締切変更後も書き換えない。
  - versioned resolverがunknown typeをdefault denyし、current profile、historical closing、fixture、post-raceを拒否する。
  - required inputのfound/missing/stale/rejected等をmanifest completenessに残す。
  - append-only/supersessionとevidence pinが成立し、参照証拠をGCしない。
  - 同一入力から決定的なmanifest hashを生成でき、Mac、CI、別環境で一致する。
  - future timestampと対象race/対象race後の情報を拒否できる。
  - source timestamp不明をstrictに拒否または隔離できる。
  - rawをdedupしても各observationを失わない。
  - parser/feature versionを固定して再現できる。
  - 現在のracer profileをhistoricalへ流用しない。
  - `data/boat.sqlite`を変更せず、temp/sidecar DBでvertical sliceがPASSする。
  - unknown/partial schemaをdefault denyし、migration ledger/checksumを検査できる。
  - production条件、app settings、Legacy BUY/WATCH/SKIPを変更していない。
- rollback: temp/sidecar DBを隔離し、共有rawと`data/boat.sqlite`を変更せずLegacy経路を維持。
- 次stage: F0-R。
- production eligibility: なし。

### Stage F0-R: Research Replay Foundation Rollout

- 開始gate: F0 temp DB PASS、DB copy PASS、migration時間計測、backup、WAL/lock、crash recovery、disk容量、rollback、collector非回帰が確認され、人間が明示承認。
- 入力: F0 artifact、sidecar schema、migration ledger、shadow write/outbox設計。
- scope: sidecar research DBの実環境rollout、optional shadow write、outbox/replay、lock/WAL/backup/rollback、storage quota、kill switch、health report。
- non-goals: Legacy collectorをsecondary化、同一transaction化、research write失敗のprimary伝播、モデル、BUY条件変更、無承認の`data/boat.sqlite`変更。
- tests: shadow failure isolation、bounded queue/backpressure、retry/idempotency、outbox replay、disk kill switch、crash recovery、partial migration、old reader互換。
- evidence: rollout readiness report、backup/restore証跡、collector non-regression report、shadow health report、human approval record。
- 完了gate: shadow default OFF、research停止時もprimary collector継続、証拠pin/retentionとrollbackが実環境で検証済み。
- rollback: research writer/feature flagを停止しsidecarをread-only隔離。Legacy collectorと`data/boat.sqlite`を元のまま維持。
- 次stage: N1。
- production eligibility: 研究証拠のshadow保存のみ。decision/通知/購入への接続なし。

### Phase N1: All-Bet-Type Payout Foundation

- 開始gate: F0-R completion gate通過、N1 schema/migrationの再レビュー承認。
- 入力: 公式7券種結果、payout state、返還・同着fixture、manifest contract。
- scope: 7券種払戻の正規化とraw evidence。選手・odds時系列は含めない。
- non-goals: N2以降、予測、券種選択、Legacy ROIへの混入。
- tests: selection正規化、返還・発売なし・同着、不一致保存、idempotency。
- evidence: payout coverage/integrity report。
- 完了gate: 7券種結果をrawへ遡って再現でき、未知状態を推測補完しない。
- rollback: 新規派生層を切り離し、raw/Legacy結果を保持。
- 次stage: D1。
- production eligibility: 公式事実層のread-only利用のみ。

### Stage D1: Diagnostic Ledger Foundation

- 開始gate: F0-RとN1完了。
- 入力: manifest、payout、Legacy/new方式識別契約。
- scope: frozen cohort manifest、evaluation protocol、Error Atlas v1 taxonomy pin、Uncertainty Cube契約、abstention/OOD/similarityの台帳schemaとレポート仕様。
- non-goals: BUY条件探索、SKIPモデル、原因断定。
- tests: cohort membership freeze、evaluation protocol別result、taxonomy versioning、evidence参照、unknown/multi-label、方式別集計分離。
- evidence: diagnostic contract reportと固定fixture。
- 完了gate: cohort membershipと評価規約を凍結し、失敗分類がdecision当時のmanifestと証拠へ追跡できる。
- rollback: 診断派生値だけ破棄し、decision/payout正本を変更しない。
- 次stage: N2。
- production eligibility: なし。

### Phase N2: Synchronized All-Market Observations

- 開始gate: D1完了、request budget・kill switch・運用承認。
- 入力: 全券種source map、Observation Envelope、race cutoff。
- scope: 同一batchの全selection観測、range odds、sale/refund state、観測skew、raw hash。
- non-goals: 市場整合性model、adaptive polling、production選択。
- tests: selection completeness、batch skew、range非midpoint化、checkpoint idempotency。
- evidence: 日次coverage、request budget、skew/dedup report。
- 完了gate: 券種別の時刻ずれを可視化した同期観測が固定cohortで成立。
- rollback: collector停止、append-only観測を保持、Legacy collectorを変更しない。
- 次stage: N3。
- production eligibility: なし。

### Phase N3: Versioned Pre-Race Facts and Racer Snapshots

- 開始gate: N2の観測品質gate通過。
- 入力: program/beforeinfo/weather/equipment、racer raw、F0 manifest。
- scope: versioned official information、profile/period/course-period snapshot、measurement quality。
- non-goals: strict-prior結果派生、選手特徴によるdecision変更。
- tests: effective period、source/observed time分離、current-profile trap、late update、欠損理由。
- evidence: racer PIT coverage/revision audit、official change ledger。
- 完了gate: historical raceへ当時値だけを結合でき、現在値fallbackが拒否される。
- rollback: snapshot派生層を無効化しraw/observationを保持。
- 次stage: N4。
- production eligibility: なし。

### Phase N4: Strict-Prior Derived Evidence

- 開始gate: N3完了、feature window/versionが事前登録済み。
- 入力: prior results、racer snapshots、venue-day observations。
- scope: recent/course/pair/style proxy、venue-day evidence、1-markの客観的共起label。
- non-goals: 因果的攻撃艇断定、確定水面状態、M3 full causal model。
- tests: target-row exclusion、同日後続除外、window/n再現、causal wording lint。
- evidence: strict-prior feature audit、venue-day evidence report。
- 完了gate: 全派生値が`as_of`、window、n、source manifest、feature versionを持つ。
- rollback: 派生snapshotを再計算可能な形で破棄。
- 次stage: D2。
- production eligibility: なし。

### Stage D2: Market Consistency and Sensor Diagnostics

- 開始gate: N2–N4完了。
- 入力: synchronized markets、120-state projection rules、PIT facts。
- scope: infeasibility、sensor reliability、market-vs-model quadrant、partial identification audit。
- non-goals: 価格矛盾をBUY signalにすること、券種統合model。
- tests: projection constraints、range bounds、timestamp skew sensitivity、raw contradiction retention。
- evidence: market consistency audit。
- 完了gate: 矛盾を解消せず証拠付きで定量化できる。
- rollback: diagnostic派生値のみ破棄。
- 次stage: E1。
- production eligibility: なし。

### Stage E1: Event-Study Capture

- 開始gate: N2/N3のfuture-only observationが安定し固定cohortを凍結。
- 入力: official change events、全市場観測、null-event schedule。
- scope: Event-Triggered Burst、Impossible Lag Test、Null Event Study用の取得・台帳。
- non-goals: adaptive budget、因果効果確定、後知恵でevent窓変更。
- tests: pre/post window、clock skew、negative lag、null events、budget cap。
- evidence: future-only event capture report。
- 完了gate: eventと非eventを同じ観測契約で比較できる。
- rollback: burst取得を停止し固定checkpointへ戻す。
- 次stage: E2。
- production eligibility: なし。

### Stage E2: Market Reaction Research

- 開始gate: E1の事前登録期間・件数・placebo gate到達。
- 入力: burst observations、change events、全券種batch。
- scope: impulse response、half-life、lead-lag、time-shuffle placebo。
- non-goals: 遅延をproduction edgeと断定、adaptive polling。
- tests: impossible lag、null event、time shuffle、multiplicity、券種時刻skew。
- evidence: preregistered event-study report。
- 完了gate: placeboを上回り、結果やfuture timestampを使わず再現できる。
- rollback: 仮説を棄却/保留としてregistryへ残す。
- 次stage: N5。
- production eligibility: なし。

### Phase N5: 120-State Market Baseline

- 開始gate: T-5全120通り、正式結果、最低1,000 settled、PIT品質、experiment protocol manifest、fixed split manifest、metric version、multiple-testing registryの凍結。
- 入力: synchronized markets、payout、manifest、market diagnostics。
- scope: 市場のみbaselineと券種別projection。
- non-goals: racer残差、券種選択、production。
- tests: probability sum、marginal consistency、logloss/Brier/calibration、range bounds。
- evidence: market-only fixed-cohort report。
- 完了gate: M0を決定的に再現しcommon cohort評価できる。
- rollback: model artifactを破棄し入力manifestを保持。
- 次stage: N6。
- production eligibility: なし。

### Phase N6: Market-Offset Residual Models

- 開始gate: N5 baseline凍結、N3/N4のPIT gate通過。
- 入力: M0、市場offset、事前登録feature families。
- scope: M1以降を一familyずつ比較。
- non-goals: holdout再探索、Legacy統合、production。
- tests: frozen split、ablation、calibration、max-hit除外、venue/month stability。
- evidence: model card、feature manifest、baseline comparison。
- 完了gate: 追加familyがM0を再現可能に改善し、改善しないfamilyを除外。
- rollback: model/version単位でretireしM0へ戻す。
- 次stage: N7。
- production eligibility: shadowのみ。

### Phase N7: Selective Prediction and Ticket Research

- 開始gate: N6の固定shadow model、D1/D2診断品質gate。
- 入力: 120-state distribution、Uncertainty Cube、OOD、market reliability。
- scope: abstention、券種別shadow選択、value decay、Decision Governorの独立設計。
- non-goals: Legacy ROIへの混入、単一Fragility scoreの早期採用、production。
- tests: coverage-risk、SKIP率、selected/common cohort分離、券種別ROI、CLV。
- evidence: shadow strategy card、separated evaluation report。
- 完了gate: strategy/cohort/version別に再現でき、common cohort比較と独立運用成績が分離される。
- rollback: strategyをretireしmodel shadow出力を保持。
- 次stage: N8。
- production eligibility: shadowのみ。

### Phase N8: Future-Only Formal Validation

- 開始gate: N7 strategyとcohortを凍結し、事前登録期間開始後に変更していない。
- 入力: future-only shadow decisions、正式payout、closing/final-like観測。
- scope: 独立future-only gate、Legacy fixed benchmarkとのcommon-cohort比較。
- non-goals: gate途中の条件変更、早期統合、自動購入。
- tests: ROI、最大1/2的中除外、CLV、logloss、Brier、calibration、coverage、SKIP率、bootstrap、venue/month安定性。
- evidence: N8 formal validation reportと独立production gate dossier。
- 完了gate: 事前登録した全gateを満たし、人間が別途production昇格を承認。
- rollback: shadow継続またはstrategy retire。Legacy benchmarkは不変。
- 次stage: 独立production設計（本ロードマップ外）。
- production eligibility: N8だけでは自動許可されず、独立production gateと明示承認が必要。

## 7. 優先ポートフォリオ

### S: 基盤として先に作る

- Race As-of Manifest
- Observation Envelope
- Content-Addressed Raw Cache
- point-in-time guard
- Future Timestamp Trap
- Post-Race Leakage Sentinel
- Error Atlas v1
- Uncertainty Cube
- strict-prior racer statistics
- synchronized all-market observations

### A: 基盤後の高価値研究

- OOD Ledger、Similarity Coverage
- Entry Uncertainty
- Venue-Day Evidence Vector
- Cross-Market Infeasibility Score
- Market Sensor Reliability
- Value Decay Atlas
- Partial Identification

### future-onlyでのみ成立

- Event-Triggered Burst
- Information Event Impulse Response
- Information Half-Life
- Bet-type Lead-Lag Matrix
- Null Event Study
- Time Shuffle Placebo

### deferred

- Adaptive Observation Budget
- 単一Fragility Indexへの圧縮
- 確定的な潜在水面状態
- full causal 1マークmodel

## 8. モデル層の順序

- M0: market-only 120-state baseline
- M1: market offset＋選手・枠・モーター
- M2: 展示・気象・装備
- M3: 1マーク展開・相互作用proxy
- M4: venue-day evidence
- M5: cross-market sensor integration
- M6: selective prediction / ticket strategy

M1はN3/N4の選手PIT gate、M3は主観を排したstrict-prior label gate、M5はD2、M6はD1/D2を通るまで開始しない。前段がM0を再現可能に上回らなければ後段へ進まない。

## 9. 禁止・棄却レジストリ

以下は研究アイデアではなく禁止事項として固定する。

- 勝者や決まり手から「攻撃艇」を強制確定する。
- 着順共起を「隣接艇を潰した」と主観的に命名する。
- range oddsのmidpointを観測確率として扱う。
- 同日2〜3raceだけで潜在水面状態を確定する。
- 現在のracer profileをhistorical fallbackに使う。
- 結果を見た後の的中可否でticket条件を変更する。
- 全raceを30秒以下で常時pollする。
- cross-market infeasibilityをBUY signalへ直結する。
- Error AtlasをBUY条件探索に使う。
- 不確実性を早期に単一scoreへ潰す。
- fixed cohort前にadaptive observation budgetを使う。
- historical closing oddsをT-5として扱う。
- `fetched_at`をsource published timeとして扱う。
- 対象raceまたはrace後の値をpre-race featureへ入れる。
- future-only研究をhistorical backfill可能と主張する。
- formal gate前のproduction接続または自動購入。
- HTTP取得・parse結果・typed observationを同一rowへ畳み込む。
- parser更新や評価規約変更で過去observation・ROIをUPDATEする。
- capture時checkpointを最新締切で再計算する。
- 動的SQLだけでcohort membershipを再生成する。
- manifest/cohort/evaluationから参照された証拠をGCする。
- F0で`data/boat.sqlite`を変更またはlive collectorへ接続する。
- research shadow write失敗をprimary collectorへ伝播させる。

機械可読な禁止項目は`research-idea-register.json`の`prohibitions`を正本とする。

## 10. この順序で初めて見える研究価値

最も有望なのは次の三群である。

1. **Race Time Machine＋PIT guard。** 予測精度以前に、過去の意思決定が本当に当時の情報だけで作られたかを証明できる。全研究の偽陽性を減らす価値が最大。
2. **全券種を時刻付き市場センサーとして扱うこと。** 120状態への投影だけでなく、券種ごとの更新速度・range・ノイズ・矛盾自体を診断情報にできる。ただし同期観測がない過去へは遡れない。
3. **Error Atlas＋Uncertainty Cube。** 外れをBUY条件へ変換せず、どの層が壊れたか、そもそも予測可能だったかを分離できる。SKIPモデルより先に診断契約を作るのが重要。

選手情報では、当時番組rawとstrict-prior結果から再構築できる登録番号、級別、全国/当地能力、実進入、ST、直近/コース別標本統計を最優先とする。現在値1世代の`racer_profiles`/`racer_course_stats`、対象期間不明の率、取得時点しかない値はhistorical featureに使わない。

## 11. 次の独立タスク

次はStage F0「Research Replay Foundation」のtemp/sidecar vertical sliceだけを独立タスクとして行う。F0完了後も直ちにN1へ進まず、人間承認を含むF0-Rを通す。F0で`data/boat.sqlite`変更、live collector接続、N1 migration、Error Atlas本体、全券種collector、モデル、Decision Governor、production接続を抱き合わせない。
