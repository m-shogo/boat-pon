# N2 Data Contracts — dataset / target / settlement-label / odds-timing

更新: 2026-08-02
状態: **設計＋enforcement 実装（model training は未着手）**
enforcement: [`../src/research-replay/n2DatasetContract.ts`](../src/research-replay/n2DatasetContract.ts)（純関数、tests: `n2DatasetContract.test.ts`）
label source: N1 canonical **active** settlement（`source_duplicate` 除外・`resolved` のみ）

## 1. Training Dataset Contract

- **dataset unit**: 1 (race × bet_type × bet_selection)。行 = 「ある race のある券種のある買い目」。
- **primary key**: (canonical_race_key, bet_type, bet_selection, dataset_version)。
- **required fields**: race identity（canonical_race_key, venue_code, race_no, scheduled_start）/ feature observed_at・available_at / decision_cutoff(=race lock) / canonical settlement（winning selections, payout_yen）/ target / eligibility + exclusion_reason / odds observation time / provenance(observation_id, raw_document_id, schema versions) / dataset_version。
- **inclusion/exclusion**（fail-closed、理由コード必須。「黙って drop」禁止）— `classifyEligibility`:

| settlement/resolution 状態 | 判定 | reason code |
|---|---|---|
| settled + resolved + not source_duplicate | 採用 | `eligible` |
| partially_refunded + resolved | 採用（hit/miss は payout line で成立、refund は financial 側） | `eligible` |
| refunded（全返還） | 除外 | `excluded_refunded` |
| cancelled | 除外 | `excluded_cancelled` |
| no_sale | 除外 | `excluded_no_sale` |
| pending | 除外 | `excluded_unsettled` |
| resolution=source_conflict | 除外 | `excluded_conflict` |
| resolution=unresolved/quarantined | 除外 | `excluded_unresolved` |
| source_duplicate（canonical 無効化） | 除外 | `excluded_source_duplicate` |
| 上記外・未知 | 除外 | `excluded_unknown` |

- 実測分布（`../reports/n2/n2-dataset-profile.json`）: 全 8,156,795 candidate 中 **eligible 7,833,298（96.03%）**、excluded_refunded 319,301、excluded_source_duplicate 4,196。

## 1.1 Full selection space

`enumerateBetSelections` はN1 canonical規則と同じ艇番1〜6・券種別arity・ordered/unordered規則で、各candidateの全selectionを決定順に列挙する。

| bet type | semantics | selections |
|---|---|---:|
| win | 1艇 | 6 |
| place | 1艇 | 6 |
| exacta | 順序あり2艇 | 30 |
| quinella | 順序なし2艇 | 15 |
| wide | 順序なし2艇 | 15 |
| trifecta | 順序あり3艇 | 120 |
| trio | 順序なし3艇 | 20 |
| **total** | 7券種 | **212** |

`deriveSelectionLevelLabels` は列挙した全selectionを `deriveBetLabel` に通す。`buildN2SelectionProfile` は券種別outcome、classification分母、hit率、正の払戻分布（min/p50/p90/p99/max/mean）、安定digestを集計し、矛盾するpayout/refund/special金額をfail-closedにする。`pnpm profile:n2:selection-labels -- --month=YYYY-MM` はimmutable sidecarをcloseを挟んで独立に2回openし、DB/入力再読込後の一致を検証する。現sidecarはparser v1 observationを含むため出力を `STALE_ARCHIVE_SEMANTICS` と明示し、archive監査完了前は学習truthにしない。

## 1.2 Feature dataset builder scaffold

`buildN2FeatureDatasetRows`（`n2FeatureDatasetBuilder.ts`）はeligibleなcandidateを全selection行へ展開し、label・feature値・feature provenance・selection別live oddsを結合する純関数である。DB read adapter、永続dataset、model trainingには未接続。

- featureは`validateFeaturePIT`、oddsはatomic `validateOddsUsage`を必ず同じbuild pathで通す。
- known live-only keyを`historical_safe`として渡すclass launderingを拒否する。
- feature key重複、provenance欠損、未来feature、非canonical/重複/不正/未来odds、必須oddsのselection欠損をreason code付きで拒否する。
- unsafe inputが1件でもあればcandidate全体を`excluded`として0行を返す。部分的に安全な行だけを残すsilent dropは禁止。
- ineligible settlementはtraining rowを生成しない。
- builder version: `n2-feature-dataset-builder-v1`。unit tests 8/8、targeted strict typecheck PASS。

`n2FeatureSourceAdapter.ts`はlegacy primary DB rowをbuilder inputへ変換する純関数境界である。`official_programs.imported_at`やrace dateをsource availabilityへ代用しない。`n2FeatureLineage.ts`のread-only SQLでF0 `domain_observations → parse_runs → raw_documents`を結び、race/type/raw ID三者一致、parse success、raw integrity/security/replay eligibility、official source、確定またはobserved-only時刻を検証した`n2-feature-lineage-v1`だけを昇格する。ID文字列の存在だけではlineageと認めない。oddsはcaptured_atとF0 source_observed_atの一致も必須で、available_atはverified evidenceから取得する。legacy trifectaの暗黙補完は明示optionなしでは行わない。lineage tests 6/6、adapter tests 7/7 PASS。

`n2FeatureCoverage.ts`はrace×source kind×feature keyを分母として、年代別・feature別のverified/excluded、coverage、provenance完備数、unique observation/raw数、availability basis、除外理由を決定順で集計しSHA-256 digestを固定する。同一分母の重複、不完全なverified provenance、ambiguousなexcluded eventはfail-closed。`n2FeatureCoverageReader.ts`はprimary DBとF0 sidecarを別々に`immutable=1/readOnly`で開き、公式番組1raceにつき6艇×7項目=42分母を生成する。primary race IDは`YYYYMMDD-2桁venue-2桁raceNo`との厳密一致、F0 join keyはidentity正本どおり`YYYY-MM-DD:venue:RraceNo`とする。旧readerの`YYYY-MM-DD:venue:2桁raceNo`は実F0 joinを常に0件にする契約不一致だったため、両coverage readerのE2E fixtureとともに訂正した。F0 `official_program` evidenceは唯一かつ検証済みであることを要求し、0件・複数件・不適格・feature欠損は理由付きexcludedへ落とす。`n2OddsCoverageReader.ts`はF0 typed `trifecta_market`だけを明示的な3連単live市場として扱い、指定checkpointごとに120selectionを固定分母化する。legacy `odds_timeseries_snapshots`はbet_typeがないため一切昇格しない。payload type/schema/hash、lineage、observed_at、canonical selection、重複を検査し、欠損selectionは個別excluded、同一checkpoint複数観測は全件fail-closedとする。公式番組は`pnpm profile:n2:feature-coverage -- --primary=<db> --sidecar=<db> --from=YYYY-MM-DD --to=YYYY-MM-DD`、3連単市場は同コマンドへ`--source=trifecta-market --checkpoint=T-5`を追加する。JSON event入力は`--input=<events.json>`。実入力0件は`PENDING_REAL_DATA`かつexit 2、fixtureは`FIXTURE_ONLY`で、実測と混同しない。profile tests 6/6、program reader E2E 3/3、odds reader E2E 4/4 PASS。

F0 typed registryは`official_program`を`pre_race` observationとして明示登録する。payloadはcanonical race key、source observation時刻、course 1〜6が一意な1〜6艇、登録番号・級別・全国/当地勝率/2連率・motor/boat 2連率をexact-keyで保持する。欠場等による不足艇はpayloadとして保持できるが、coverage readerでは欠損featureを明示除外する。未知field、重複course、非canonical identity、不正時刻、範囲外rateはfail-closed。golden fixtureのsemantic SHA-256は`06be00c42eaaaa9f5845d29e7af30a49740bc02b6f3694bcfe3afac7558cdb82`。registry契約tests 3/3 PASS。

`n2OfficialProgramObservation.ts`はprimary `raw_json`を`official-program-primary-raw-v1`として決定順typed payloadへ正規化し、`n2-official-program-parser-v1` envelopeを生成する。数値文字列は有限値へ正規化する一方、`null`/空文字は0へ置換せずnullを維持し、非数値・重複course・範囲外rate・published>observed>firstSeenの時刻矛盾をfail-closedにする。coverage readerはF0 lineageだけでなく`typed_observation_payloads`をJOINし、domain/typed双方のpayload type・schema・hash、canonical identity、observed_at、primary rawのsemantic payloadが全一致する場合だけ42 featureをverifiedへ昇格する。typed payload欠落・hash不一致・primary差異はreason code付きで全featureを除外する。program parser tests 3/3、program reader E2E 4/4、共通欠損rate regression 3/3を含む対象tests 17/17、targeted strict typecheck PASS。実sidecarへのcollector writeと実coverageは未実行である。

`ResearchReplayRepository.parseTypedRawDocument`は、content-addressed storeへ保存済みのbyte-exact rawを必ず再読込してtyped parserを実行し、parse runとobservation/payloadの保存を共通化する。`ingestOfficialProgramObservation`はprimary `raw_json`そのものをraw evidenceとして記録し、正規化envelopeをraw原本として偽装しない。parse/validation失敗も`parse_runs.status=error`として残し、domain observationとtyped payloadは0件のままにする。temp sidecar→typed payload→immutable coverage reader E2Eは2/2 PASS（正常rawは42/42 verified、不正rawはpartial write 0）、関連回帰を含む対象tests 9/9・targeted strict typecheck PASS。これはoffline adapterであり、live collector writerは引き続きOFFである。

`captureOfficialProgramObservation`はtemp/offline collector adapterとして、`capture_attempt → capture_started → response_headers_received → byte-exact raw → body_completed → capture_raw_link → parse_run → domain_observation → typed payload`を一周させる。request/event時刻は単調増加、`source_observed_at = body_completed_at`、body eventのbyte countとraw実サイズ、body event/attempt所有関係、link時刻をrepositoryでfail-closed検証する。URL secretと非allowlist headerは保存しない。parse失敗はcapture成功と分離し、raw/link/error parse runを保持してobservationを作らない。同一rawの再取得ではcapture attempt/event/raw linkを各試行分保持しつつ、同じcanonical race・raw・parser/source schema・payload typeに対する未supersedeのverified typed observationが一意な場合だけ既存parse/observationを再利用する。これによりHTTP retryをdomain eventへ二重計上せず、coverage readerのambiguous全件除外を防ぐ。再利用候補が複数、hash/schema不整合、別race、別parserならfail-closedまたは新規parseとし、raw bytesだけで外部race identityを流用しない。collector E2E 5/5、関連回帰込み21/21・targeted strict typecheck PASS。実collector writerは引き続きOFF。

## 2. Target Contract

raw truth を直接 target にしない。canonical active settlement からのみ導出（`deriveBetLabel`）。段階分離:
`base predictive target（hit 確率）→ calibration → market odds → expected value → decision policy`。決定を直接 target にしない（既存 policy への過学習回避）。

| target | 定義 | source | 備考 |
|---|---|---|---|
| `outcome` | `hit / loss / refund / special_payout / void` | canonical payout/refund line | classificationとfinancial事象を分離 |
| `hit`（classification） | bet_selection ∈ canonical winning selections → 1/0 | payout line canonical | refund / special_payout / void は **null（loss 扱い禁止）** |
| `payoutYenPer100`（financial） | hit時の払戻、lossは0、refund/special_payoutは実額 | payout/refund line | 金額不明のrefundはnull（100円を推測しない） |

- 券種別 semantics: win/place=艇番、exacta/quinella/wide=2艇、trifecta/trio=3艇（順序あり/なしは N1 canonical に従う）。同着は複数 winning selection（`deriveBetLabel` は複数一致で hit=1・該当 payout を採用）。
- class balance（実測、eligible 比率）: win 99.95% / place 97.45% / exacta 95.03% / quinella 95.03% / trifecta 94.92% / trio 95.02% / wide 95.05%（refund 率が多艇券種で高い）。hit 率自体は券種で大きく異なる（trifecta ≪ win）ため **券種別 target/calibration を必須**とする。

## 3. Settlement → Label Contract（fail-closed）

- **canonical active** のみ使用（`source_duplicate` は label を二重計上しない — active view で除外済み、resolved 624）。
- revision: 現行 canonical resolution を使用、reproducibility のため schema/resolution version を manifest に固定。
- refund: `refundedSelections` とselection別実返還額を渡し、対象selectionを `outcome=refund / hit=null` にする。candidateが `partially_refunded` でも非返還selectionだけが通常のhit/lossになる。
- special payout: 券種別実額を `specialPayoutYenPer100` で渡し、全selectionを `outcome=special_payout / hit=null` にする。通常のwinning selectionへ推測変換しない。
- cancel/no_sale: label 不成立（除外）。unsettled/conflict/unknown: fail-closed 除外。
- target contract version: `n2-target-contract-v2`。
- state fixture は `n2DatasetContract.test.ts` で固定（全7券種212 selection、hit/loss、部分返還、特払い、各除外理由、ineligible→void/null）。対象契約testは12件PASS。

## 4. Odds Timing Contract（atomic `validateOddsUsage`）

| role | 使用可 odds | 禁止 |
|---|---|---|
| feature（training） | live_checkpoint（cutoff 以前） | closing / post_race_imputed / unknown |
| evaluation（価格評価専用） | closing / live_checkpoint | post_race_imputed / unknown |
| decision | 意思決定時点で available な odds | closing / post_race |

- final/closing odds を **training feature に入れない**。closing は「価格評価専用」と明示。
- `validateOddsUsage` は `kind / role / capturedAt / availableAt / decisionCutoff` を単一inputで検証する。kindだけの事前判定は禁止。
- live checkpointは `capturedAt <= decisionCutoff` かつ `availableAt <= decisionCutoff`。境界一致は許可し、1msでも未来なら拒否する。
- provenance整合性として `availableAt <= capturedAt` を必須にする。欠損・不正時刻・未来時刻・unknown/post-race kindはreason code付きでfail-closed。
- closingは時刻の妥当性と`availableAt <= capturedAt`を満たす場合でもevaluation専用。feature/decisionには使用できない。
- feature PIT contract version: `n2-feature-pit-contract-v2`。
- 既知バイアス（CLAUDE.md）: `current_odds` は締切前暫定で約14.94pt の楽観バイアス、gap≥10pt では current_odds 判断を信頼しない。実払戻（N1 `payout_yen`）を label/財務評価の主基準にする。

## 5. 温度・coverage 制約（N2 が前提にすること）

- **temporal coverage gap**: local archive は **2001–2003 が欠落**、2000 は部分（131 files）。usable historical range は実質 **2004–2026（+部分2000）**。詳細 `../docs/missing-dates.md` / `../reports/n2/n2-dataset-profile.json`。
- **eligibility drift**: eligible 比率が 2004–2006 ≈87% → 2020+ ≈99.9% と drift（早期の返還/除外率が高い）。N2 の split/評価は era drift を考慮する（[`n2-evaluation-and-split.md`](n2-evaluation-and-split.md)）。
