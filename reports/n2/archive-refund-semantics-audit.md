# Archive refund semantics audit

更新: 2026-08-01  
状態: **SCANNER_IMPLEMENTED / RAW_ARCHIVE_IMPACT_PENDING**

## 結論

旧 `n1-settlement-parser-v1` には、archive中の「特払い」をrace-wide返還として扱う分類bugがあった。

`parseOfficialResultDetail` は従来、同一race内で「不成立」または「特払い」を見つけると `returned=true` をrace終了まで保持した。そのため「特払い」の行自体だけでなく、後続してparseされる正常な他券種払戻行まで `RacePayout.returned=true` になった。さらに `classifyRaceLines` は `returned=true` を `ARCHIVE_RETURNED / refundYenPer100=100` へ変換するため、70円の特払いと100円返還が混同された。

これは次の契約と矛盾する。

- N1 fixture: 特払いは `lineKind=special_payout`、`payoutYen=70`
- 返還: `race_refund_lines_v2`、通常100円
- 特払い: 的中selectionへの通常配当がない券種で、その券種の購入票へ行う券種別払戻。race全体の不成立ではない

## 修正

- race-wide `returned` sentinelは「不成立」だけで立てる
- 「単勝 / 複勝 / 2連単 / 2連複 / 拡連複 / 3連単 / 3連複 + 特払(い) + 金額」を券種別 `special_payout` lineとしてparse
- sourceに金額がない場合は70円を推測補完せず、既存fail-closed方針を維持
- parser versionを `n1-settlement-parser-v2` へ更新
- 回帰testで、特払い後のexacta/trifectaが返還へ汚染されないこと、不成立は引き続きrace-wide返還になることを固定

実装commit:

- `5a4efc980607905595da09bf65324cbd10f49c2a` — parser分類修正
- `c9e28b5b9d72ee82145c553c8d407f99441e1fd1` — parser version v2
- `a0ff30aab11649abcbf90d22fdc476651c872084` — regression tests

## 影響範囲

### 確定

- v1コードでは「特払い」以降の同race正常払戻行が返還化し得た
- N2 profileの `excluded_refunded=319,301` と早期eraのeligible低下は、v1分類を入力に含む
- append-only sidecarの既存v1 observation/candidateは、このコード修正だけでは変化しない

### 未確定

- 319,301件のうち何件が誤分類か
- year × bet_type別の誤分類数
- 2004–2019のeligible driftをこのbugが何%説明するか
- 特払いと実返還が同時に存在するraceの正しいselection-level financial label

したがって、既存profileの約87%→99.9%を制度差・実返還率driftとして学習設計に使わない。N2 label truthはfull raw reparse差分が終わるまで未確定。

## v1/v2差分scanner

実装済み:

- `parseOfficialResultDetailLegacyV1ForAudit`: production既定をv2のまま維持し、旧bugを監査専用に再現
- `compareRefundSemantics`: unchanged候補を全件保持せず、変更行と集計値だけを返す
- `scripts/audit-archive-refund-semantics.ts`: immutable K archiveをv1/v2でread-only二重parse
- `pnpm audit:n2:archive-refund-semantics`: full scan
- `pnpm audit:n2:archive-refund-semantics -- --limit=20`: smoke scan
- 出力: `reports/n2/archive-refund-semantics-diff.json/.md`
- 集計軸: `year × bet_type × event_kind`
- event: `special_payout_added` / `false_refund_reclassified` / `other_change`
- N2 profileの319,301件はcanonical candidate-levelなので、raw scanner値と即時同一視せずsource-duplicate resolution後にreconciliationする

scanner実装commit:

- `b7c03a3f267ee2479063eb63f5f9581db294ec55` — v1 audit-only parser
- `35150b4832096ad3eb11146a489f4dfe66e15672` — pure semantics comparator
- `a9f08b1e1d301aa6907141fc7cc99edc0c7bde18` — v1/v2 regression assertions
- `6e242b5353889bb7e2a62bec52148774dd247ec7` — full archive scanner
- `13d77eecd256252bf57f6aa79bbf9aaeada70442` — package command

## 検証

- v1/v2 synthetic archiveをNode 24のTypeScript strip実行でruntime smoke: **PASS**
- v1: 特払い券種lineなし、後続exacta/trifectaがreturned=true
- v2: win special_payout=70、後続exacta/trifectaはreturned=false
- 新規scanner/helper/testの構文check: **PASS**
- full unit/typecheck/build: **PENDING**（GitHub Actions run/status未生成、raw archiveを持つlocal checkout未接続）

## Non-blocking label hardening

raw archiveが未接続でも確定できる別のlabel契約bugを修正した。

- `partially_refunded` はeligibleだが、旧 `deriveBetLabel` は返還対象selectionを受け取れず `hit=0 / payout=0` にしていた
- special payoutもwinning selectionを持たないため、旧契約のままselection列挙すると全件lossになり得た
- target contractを `n2-target-contract-v2` へ上げ、`outcome=hit/loss/refund/special_payout/void` を追加
- refund / special_payout / void は `hit=null`。financial targetだけに実返還/特払額を保持し、金額不明を100円へ推測補完しない
- Node 24 contract test: 10 pass / 0 fail

commit: `947f9224153f23130181f212a9a7a0dad5b45e9d` (contract), `4aefcee1f4caf9a005d7507eea83022aeaa56b01` (test), `a32fc1f1d407e9fc8ce7e3aecc1deef65f9e591a` (docs)

## Selection-level prototype foundation

- 全7券種のcanonical selection空間を決定順で列挙: win 6 / place 6 / exacta 30 / quinella 15 / trifecta 120 / trio 20 / wide 15（計212）
- ordered券種は順列、unordered券種は昇順組合せ、艇番重複なし
- `deriveSelectionLevelLabels`で全selectionを実際に`deriveBetLabel`へ通す
- exacta fixtureで通常=1 hit+29 loss、部分返還=1 hit+1 refund+28 loss、特払い=30 special_payout、全返還=30 voidを固定
- targeted TypeScript strict check: PASS / Node 24 contract tests: 10 pass

commit: `3b32ab33b45f679dda64a41935cd281585afad94` (enumerator), `a7be4cf057ff15094a0bba3067336f3cac2ac2c1` (tests)

実DBの券種別class balance・hit率・payout分布はまだ未生成。既存candidate-level profileをselection-level実測と呼ばない。

## Independent selection profile rebuild

- `buildN2SelectionProfile`: 全selectionのoutcome/class balance/hit率/正の払戻分布/digestを純関数集計
- payout・special payout・refundの金額競合はfail-closed
- `profile:n2:selection-labels`: immutable sidecarを独立に2回openし、1回目close後のDB/入力再読込でdigest・件数・券種別profileを比較
- 現sidecarの出力は必ず`STALE_ARCHIVE_SEMANTICS`。archive訂正前にtraining truthへ昇格しない
- isolated SQLite end-to-end fixture: 4 candidates / 120 selections / independent rebuild PASS
- profile unit tests: 4 pass / targeted strict typecheck: PASS / script syntax: PASS

commit: `2e4dcbfb7aec033b615a432b9678ddfe0edad644` (builder), `368787bf6524034a8410890b70ffd1a6794e853d` (tests), `e3e5c9fb7465a185e3daa43b966a0a51bbf07dbe` (DB reader), `b5c6beccd3c44b00ebe0030264edf275e78d8665` (strict type fix)

## Non-blocking hardening: odds atomic PIT guard

raw archive未接続中の独立sliceとして、旧`validateOddsUsage(kind, role)`がlive checkpointの実時刻を検証しない契約不一致を修正した。新guardはkind/role/capturedAt/availableAt/decisionCutoffを一体で検証し、cutoff後・時刻矛盾・欠損をfail-closedにする。closingは価格評価専用のまま。本変更はarchive再集計値、DB、production判定へ影響しない。

- Node 24 contract tests: 12 pass / 0 fail
- targeted TypeScript strict check: PASS
- selection builderへの接続: COMPLETE / 実DB adapter: PENDING

## Non-blocking hardening: feature dataset builder scaffold

selection-level label、feature PIT、atomic odds PIT、provenanceを一つの純関数build pathへ接続した。known live-only keyのclass laundering、未来feature/odds、非canonical odds、必須odds欠損、provenance欠損はcandidate全体0行でfail-closedにする。DB read adapter、永続dataset、trainingには未接続。

- builder unit tests: 7 pass / 0 fail
- targeted TypeScript strict check: PASS
- archive再集計値・DB・productionへの影響: なし

## Non-blocking hardening: legacy feature source adapter

primary DB schemaを再監査し、`official_programs`には`imported_at`しかなくsource availability/raw lineageがないこと、`odds_timeseries_snapshots`にはcaptured_atがある一方available_at/raw lineageがなく、既存schemaではbet_typeも固定されていないことを確認した。これらを推測補完しないpure adapterを追加した。

- programのrace date/imported_atをsource availabilityへ代用しない
- F0 observation/raw lineageがないprogram/odds rowはfail-closed
- bet_type不明legacy oddsをexacta/quinellaへ推測しない
- namespaced live-only feature keyのclass launderingを拒否
- adapter tests 6/6、builder regression 8/8、targeted strict typecheck PASS

## Non-blocking hardening: verified F0 feature lineage

旧source adapterは`observationId/rawDocumentId`が非空ならlineage済みと扱い、F0の実証拠鎖を検証していなかった。`n2-feature-lineage-v1`を追加し、read-only SQLで`domain_observations → parse_runs → raw_documents`を結び、race/type/raw chain、parse success、raw integrity/security/replay eligibility、official source、時刻品質・順序をすべて満たす場合だけadapterへ昇格する。oddsはlegacy captured_atとF0 source_observed_atの一致も必須。

- lineage tests: 6 pass / adapter integration tests: 7 pass
- targeted TypeScript strict check: PASS
- 実DB/sidecar write: 0
- 未確認: 実sidecar join率、feature×年代coverage。`official_program` typed契約は追加済みだが実collector observationがなく、全券種market observationも未整備

## Non-blocking hardening: feature coverage/provenance profile

`n2-feature-coverage-v1`を追加し、race×source kind×keyを分母として年代/feature別coverage、provenance完備数、unique observation/raw、availability basis、除外理由、決定的digestを集計する。重複分母・不完全verified event・ambiguous excluded eventはfail-closed。実入力0件は`PENDING_REAL_DATA`+exit 2とし、空profileを実測成功へ昇格しない。

- unit tests: 6 pass / targeted TypeScript strict check: PASS
- CLI no-input smoke: `PENDING_REAL_DATA`, exit 2（期待通り）
- 実DB/sidecar write: 0
- 未確認: 実sidecarからのcoverage event生成・実join率

## Non-blocking hardening: immutable dual-DB coverage reader

`n2-feature-coverage-reader-v1`を追加し、primary `official_programs`とF0 evidence sidecarを別々に`immutable=1/readOnly`で開いて、1raceあたり42 official-program feature eventを生成する。race identityの曖昧変換は拒否し、`official_program` evidence 0件・複数件・検証不合格を理由別excludedとして明示する。隔離SQLite E2E 3/3とtargeted strict typecheckがPASSし、reader前後の両DB SHA-256一致も確認した。実DB入力がないため実join率は未確認。

## Non-blocking hardening: immutable trifecta market coverage reader

`n2-odds-coverage-reader-v1`を追加し、primary race universeとF0 typed `trifecta_market`をimmutable/read-onlyで結合する。指定checkpointごとに3連単120selectionを分母化し、payload type/schema/hash、lineage、observed_at、selection spaceを検証する。bet_typeなしlegacy oddsは推測昇格しない。隔離SQLite E2E 4/4、targeted strict typecheck、reader前後DB SHA-256一致がPASS。実sidecar coverageと全券種live marketは未確認/未整備。

## Non-blocking hardening: canonical F0 identity + official-program typed payload

coverage readerが生成していた`YYYY-MM-DD:venue:2桁raceNo`はF0 identity正本`YYYY-MM-DD:venue:RraceNo`と一致せず、実sidecar joinを常に0件にする確定bugだった。shared race-key helperとprogram/odds E2E fixtureを正本形式へ訂正した。さらにF0 registryへstrict `official_program / pre_race` payloadを追加し、1〜6艇の一意course、登録番号、級別、各rate、canonical identity、source observed時刻、exact keysを検証する。不足艇はpayloadで保持しcoverageでは欠損featureとして明示除外する。golden semantic hashを固定し、契約3/3を含む対象tests 10/10、targeted strict typecheckがPASS。実collector生成・primary raw_json値照合・実coverageは未確認であり、fixture結果を実測へ昇格しない。

## Non-blocking hardening: official-program parser + semantic reconciliation

共通`programFeatures` parserの`Number(value)`は`null`と空文字を0へ変換し、欠損rateを「実値0」として特徴補正へ入れ得た。null/undefined/blankはnullのまま保持し、実値0だけを0として残す回帰testを追加した。`n2-official-program-parser-v1`はprimary rawからtyped payload/envelopeを決定的に生成し、非数値・重複course・rate範囲・source時刻順序をfail-closedにする。immutable coverage readerはF0証拠鎖だけでは昇格せず、typed payload rowの存在、domain/typed schema/hash、canonical identity、observed_at、primary rawのsemantic一致を要求する。missing typed payloadとprimary差異のE2Eを追加し、対象17/17 testsとtargeted strict typecheckがPASS。実sidecar/primary DB writeは0で、実collector接続・実profileは未確認。

## Non-blocking hardening: byte-exact official-program F0 ingest

既存F0 fixture parserはraw document自体がenvelopeである前提だったため、そのまま公式番組へ流用すると正規化envelopeをraw原本として保存する危険があった。repositoryへbyte-exact rawを再読込する共通typed parser経路を追加し、official-program adapterはprimary `raw_json`そのものをraw storeへ保存してからtyped payloadを生成する。temp sidecar E2Eでraw byte一致、parse/domain/typed lineage、coverage 42/42 verifiedを確認。不正JSONは`parse_runs.status=error`だけを残し、observation/payloadは0件。新規2/2、関連回帰込み9/9、targeted strict typecheck PASS。実DB・live collectorは変更していない。

## Non-blocking hardening: complete official-program capture lineage

temp collector adapterで`capture_attempt/events → raw_document/link → parse_run → domain_observation → typed payload`を接続した。汎用repositoryがbody eventのbyte count欠落やraw実サイズ不一致、request以前/前event以前の時刻、body eventの別attempt所属、body完了前linkを許し得たため、すべてfail-closed検証へ修正。URL secret・非allowlist headerは保存しない。parse errorはcapture成功としてraw/linkを保持し、取得failureと混同しない。collector E2E 3/3、関連回帰込み12/12、targeted strict typecheck PASS。実collectorと永続sidecarは変更していない。

## 次gate

1. `--limit=20` smoke scan + full repo unit/typecheck
2. raw archive全件を再parseし、`year × bet_type × event_kind`を確定
3. 319,301候補とのcanonical/source-duplicate reconciliationを取る
4. append-only `parser_reparse` / supersession計画をtemp copyで検証
5. corrected canonical label profileを独立DB再読込で再生成
6. その後にselection-level N2 prototypeへ進む

## 安全

- 実DB、primary DB、sidecar、archiveへのwriteなし
- existing v1 evidenceの削除・上書きなし
- collector、production判定、BUY/WATCH/SKIP、自動投票への変更なし

## Non-blocking hardening: official program retry dedup

raw archive/実sidecar未接続中の独立sliceとして、同一公式番組rawのHTTP retryが同じraceへparse/domain observationを重複生成し、immutable coverage readerを`excluded_lineage_ambiguous_match`へ落とす不具合をfixtureで再現・修正した。

- retryごとの`capture_attempt`、capture events、`capture_raw_link`はappend-onlyで保持する。
- byte-exact rawはcontent hashで1件へdedupする。
- 同一canonical race・raw・parser version・source schema・payload typeで、未supersedeの成功typed observationが一意かつparse/domain/typed hash・schema整合する場合だけ再利用する。
- 候補複数やintegrity不一致はfail-closed。rawが同じでもcanonical raceが異なれば新しいparse/observationを作る。
- fixture結果: same-race retry = 2 attempts / 2 raw links / 1 raw / 1 parse / 1 observation。different-race same bytes = 1 raw / 2 observations。
- collector E2E 5/5、program/coverage/odds関連回帰込み21/21、targeted strict TypeScript PASS。

本変更はarchive refund再集計値、既存DB、production予測、BUY条件を変更しない。

## Non-blocking hardening: capture failure retry isolation

raw archive未接続中の独立sliceとして、公式番組取得のtimeout等を成功captureと混ぜないadapterとE2Eを追加した。失敗attemptは`capture_started → capture_failed`でterminalとなり、後から`body_completed`を追加して成功へ反転できない。retryは同じ`logical_request_group_id`を持つ新attemptで行い、成功retryだけがraw/link/parse/domain observationを生成する。

fixture結果: 2 attempts（failed 1 / succeeded 1）、raw link 1、raw 1、parse 1、observation 1。collector E2E 6/6、program/coverage回帰12/12、targeted strict TypeScript PASS。F0-Rの既存`runPrimaryWithOptionalShadow`、outbox retry、rollback/kill switchと役割を重複させず、live writerはOFFを維持する。本変更はarchive集計値・実DB・予測・BUY条件へ影響しない。

## 2026-08-02 official_program shadow outbox slice

archive raw入力は今回も到達不能で、year × bet_type × event_kind、約319,301候補、eligible 87%→99.9%の再集計は未確認のままである。既存profileをtraining truthへ昇格しない。

非ブロック作業として、公式番組captureを既存F0-R outboxへ接続するcontractを実装した。outboxはraw本文を保持せずprimary record IDと期待SHA-256を保持し、consumerはprimary raw再読込後のbyte hash一致前にcapture evidenceを書かない。default OFF、exact retry idempotency、一回配送、raw改変fail-closed、backpressureのprimary非伝播をtemp E2Eで固定した。実DB、live writer、予測、BUY条件は変更していない。

## 2026-08-02 mixed shadow routing / rollback slice

raw archive入力は今回も存在せず、archive refund実数再集計は未確認である。非ブロック作業として、F0-R outboxの決定的エラーがmax retryまで滞留する問題を修正した。message type router、初回permanent failure、一時障害backoff retry、kill-switch rollback後の配送停止をtemp E2Eで固定した。queued messageとappend-only delivery historyはrollbackで削除しない。実DB、live writer、予測、BUY条件は変更していない。

## 2026-08-02 shadow delivery single-writer slice

raw archive入力は今回も存在せず、refund実数監査は未確認である。非ブロック作業として、二つのconsumerが同一outbox rowをhandler実行前に読み、二重配送できる競合を修正した。messageごとの`BEGIN IMMEDIATE`、lock後state再読込、handler＋attempt appendのtransaction境界を追加した。typed observation内部atomic writeはsavepointへ変更し、claim transaction内でも動作する。schema migration、実DB、live writer、予測、BUY条件の変更はない。

## 2026-08-02 shadow contention observability / crash recovery slice

raw archive入力は今回も存在せず、year × bet_type × event_kind、約319,301候補、eligible率差は未確認である。非ブロック作業として、競合consumerの安全なskipがqueue空と同じ戻り値になる運用上の盲点を、互換性を維持した`drainWithDiagnostics`（examined / contended / skippedAfterClaim）で可視化した。さらに別Node processをhandler transaction中に`process.exit(77)`で終了し、handler内DB side effectとdelivery attemptがともにrollbackされ、再open後にqueued messageを1回だけ成功再配送できることをE2Eで確認した。関連32/32 tests、targeted strict TypeScript PASS。schema migration、実DB、live writer、予測、BUY条件の変更はない。
