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

Phase N0は完了している。次の独立実装タスクはStage F0「Research Replay Foundation」であり、Phase N1ではない。本タスクでは文書だけを確定し、F0、N1、DB migration、収集、モデル、production接続を実装しない。

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

同じraceに複数方式のdecisionを保存できる設計にする。将来のdecision・paper evaluationは最低限、`decision_system`、`strategy_version`、`model_version`、`feature_version`、`manifest_id`、`cohort_id`、`evaluation_mode`、`ticket_type`、`selection`、`decision`を持つ。設計上の一意性は、race identityにこれらの評価識別子を加えた複合キーで確保する。

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

## 5. 実装順序

順序は次で固定する。

`Stage 0 → F0 → N1 → D1 → N2 → N3 → N4 → D2 → E1 → E2 → N5 → N6 → N7 → N8`

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
- 入力: official raw/cache、既存race identity、N0のPIT/source-quality設計。
- scope: As-of Manifest、Observation Envelope、content-addressed raw cache契約、PIT guard、Future Timestamp Trap、Post-race Leakage Sentinel、再生fixture。実装時もLegacy判定経路から隔離する。
- non-goals: N1払戻migration、収集job、モデル、Error Atlas本体、Decision Governor、BUY条件変更。
- tests: manifest hash決定性、同一raw別観測保持、時刻境界fixture、parser/feature version再現、Legacy回帰。
- evidence: replay conformance report、fixture manifest、hash再現ログ、境界テスト結果。
- 完了gate:
  - 同一入力から決定的なmanifest hashを生成できる。
  - future timestampと対象race/対象race後の情報を拒否できる。
  - source timestamp不明をstrictに拒否または隔離できる。
  - rawをdedupしても各observationを失わない。
  - parser/feature versionを固定して再現できる。
  - 現在のracer profileをhistoricalへ流用しない。
  - production条件、app settings、Legacy BUY/WATCH/SKIPを変更していない。
- rollback: F0 namespace/feature flagを無効化し、共有rawを消さずLegacy経路を維持。
- 次stage: N1。
- production eligibility: なし。

### Phase N1: All-Bet-Type Payout Foundation

- 開始gate: F0 completion gate通過、N1 schema/migrationの再レビュー承認。
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

- 開始gate: F0とN1完了。
- 入力: manifest、payout、Legacy/new方式識別契約。
- scope: Error Atlas v1 taxonomy、Uncertainty Cube契約、abstention/OOD/similarityの台帳schemaとレポート仕様。
- non-goals: BUY条件探索、SKIPモデル、原因断定。
- tests: taxonomy versioning、evidence参照、unknown/multi-label、方式別集計分離。
- evidence: diagnostic contract reportと固定fixture。
- 完了gate: 失敗分類がdecision当時のmanifestと証拠へ追跡できる。
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

- 開始gate: T-5全120通り、正式結果、最低1,000 settled、PIT品質、固定split。
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

## 6. 優先ポートフォリオ

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

## 7. モデル層の順序

- M0: market-only 120-state baseline
- M1: market offset＋選手・枠・モーター
- M2: 展示・気象・装備
- M3: 1マーク展開・相互作用proxy
- M4: venue-day evidence
- M5: cross-market sensor integration
- M6: selective prediction / ticket strategy

M1はN3/N4の選手PIT gate、M3は主観を排したstrict-prior label gate、M5はD2、M6はD1/D2を通るまで開始しない。前段がM0を再現可能に上回らなければ後段へ進まない。

## 8. 禁止・棄却レジストリ

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

機械可読な禁止項目は`research-idea-register.json`の`prohibitions`を正本とする。

## 9. この順序で初めて見える研究価値

最も有望なのは次の三群である。

1. **Race Time Machine＋PIT guard。** 予測精度以前に、過去の意思決定が本当に当時の情報だけで作られたかを証明できる。全研究の偽陽性を減らす価値が最大。
2. **全券種を時刻付き市場センサーとして扱うこと。** 120状態への投影だけでなく、券種ごとの更新速度・range・ノイズ・矛盾自体を診断情報にできる。ただし同期観測がない過去へは遡れない。
3. **Error Atlas＋Uncertainty Cube。** 外れをBUY条件へ変換せず、どの層が壊れたか、そもそも予測可能だったかを分離できる。SKIPモデルより先に診断契約を作るのが重要。

選手情報では、当時番組rawとstrict-prior結果から再構築できる登録番号、級別、全国/当地能力、実進入、ST、直近/コース別標本統計を最優先とする。現在値1世代の`racer_profiles`/`racer_course_stats`、対象期間不明の率、取得時点しかない値はhistorical featureに使わない。

## 10. 次の独立タスク

次はStage F0「Research Replay Foundation」の実装だけを独立タスクとして行う。F0完了後にN1へ進む。F0でN1 migration、Error Atlas本体、全券種collector、モデル、Decision Governor、production接続を抱き合わせない。

