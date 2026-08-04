# boat-pon AI作業引継ぎ（正本）

更新: 2026-08-03

この文書は、過去チャットを読めない別のAIチャットが現在地を誤解せず再開するための入口である。数値は更新時点のスナップショットなので、作業開始時に下記コマンドで再計測する。

## 最初に読むもの

1. `CLAUDE.md` — 絶対禁止事項。禁止事項は常に最優先。
2. `docs/research-platform-master-plan.md` — N0後の研究基盤・評価分離・実装順序の最上位正本。
3. `docs/current-ai-handoff.md` — 現在地と次の作業。
4. `reports/current-system-correctness-audit.md` — 正誤・未完了一覧。
5. `docs/prediction-improvement-roadmap.md` — 収益性改善のgate。
6. `reports/t5-collector-efficiency.md` — T-5収集率と重複率。
7. `docs/odds-timeseries-compaction-runbook.md` — DB圧縮の人間向け手順。
8. `docs/market-residual-ticket-selection-roadmap.md` — 市場残差・全券種選択の詳細計画。

`CLAUDE.md`内の2025-06フェーズ説明には古い数値がある。禁止事項は有効だが、現在状況はこの文書と上記監査レポートを正本にする。

## 結論

- 現行システムは完璧ではない。
- 収集・通知経路の重大な欠陥は修正したが、予測確率と収益性は不合格。
- BUYはpaper観察候補であって購入指示ではない。BUY増加を予測改善と解釈しない。
- 修正前T-5標本は、前checkpointの5分キャッシュを再利用した可能性を完全には除外できない。
- 正式な収益評価は、2026-07-21 15:15 JST以降に公式networkから直接取得したfuture-only T-5だけでやり直す。
- DB肥大化の新規増加は抑制済みだが、13.98GiBの原本圧縮は未実施。
- Phase N0「全券種＋選手PIT＋独自研究軸データ取得可能性・保存設計監査」は読み取り専用で完了した。DB migration、実収集、モデル、production接続は未着手。
- N0後の正本は`docs/research-platform-master-plan.md`、研究40件と破綻防止契約の機械可読台帳は`docs/research-idea-register.json`。Stage F0とF0-Rは`COMPLETE`。Phase N1-A offline foundationも`COMPLETE`で、schema `n1-settlement.0.1`、20-case fixture、7券種parser、8,164 archive dry-run、Legacy read-only reconciliationを実装済み。
- Phase N1-B（Permanent Settlement Schema Rollout & Capacity Gate）は`CONDITIONAL`。`n1-settlement.0.1`を永続sidecar `data/research-replay.sqlite`へ**zero-data**で適用済み（全7 table 0件、checksum一致、trigger 14、integrity ok）。実archive stratified sample（75 files / 11,621 races）で容量実測し、full backfill projected DB ≈10.5GB（base）は現1GiB quotaに**収まらない**。evidence pinはDBの約33%（full ≈23M行）でOption B削減を決定。正本は`docs/n1-settlement-permanent-rollout.md`、backfill契約は`docs/n1-settlement-backfill-design.md`。
- Phase N1-C（Persistent Sidecar Backfill）は**Backfill execution=COMPLETE / Final verification=COMPLETE / N1-C acceptance=CONDITIONAL / Overall=CONDITIONAL**。`n1-settlement.0.2`（checkpoint table、expand-only、0.1不変）を永続sidecarへ適用し、Option B（`emitEvidencePins=false`）で全券種settlementを段階backfill（8,168/8,168完了・failed 0）。candidates **8,154,709**、payout 11,073,826、refund 446,893、**evidence pins 0**、implicit FK refs 24,464,127。最終DB **≈9.0GB**（sample予測5.38GBから+67.5%、要quota再評価）。正本は`reports/n1c-backfill/n1c-final-report.md`、運用は`docs/n1-settlement-backfill-runbook.md`。
- N1-C closure（2026-07-29）で2つのverification debtを解消: (A) authoritative full verify（integrity ok / fk 0 / observation-level dup 0 / coverage / pins 0）、(B) +5,153 line delta を完全 reconciliation（unexplainedDelta=0 / simMatchesDb=true / parser determinism 0）。reconciliation が **source archive の intra-file 重複**を surface: 4 file（2008-07-06/07-13, 2009-04-06/07-08）が日次データを物理重複格納 → race-level 重複 candidate **4,196** / dup observation 624 / dup line 11,658。source-data defect・N1 pipeline bug ではない・値誤りなし。
- **N1-C source-duplication closure（2026-07-29、append-only）**: `n1-settlement.0.3`（`settlement_source_duplicate_resolutions_v2`、expand-only、0.1/0.2 byte不変）で 624 races の重複 observation を `source_duplicate` として canonical original（source順で最初のobservation）へ mapping。**raw immutable**（observations 1,194,679 / candidates 8,154,709 unchanged、raw 重複 624/4,196 は audit可能）、**active canonical 重複 0/0**、inserted 624・rerun 0（冪等）・value conflict 0（624 races で candidate集合完全一致を事前検証）。恒久 invariant（active canonical race-level uniqueness=0）を `verify`/reconciliation/future-ingest guard に組込。その後 live-archive 日次追加 k260727/728 を incremental backfill（8,170/8,170、新file重複なし）。DB candidates 8,156,795。正本 `reports/n1c-backfill/source-duplicate-resolution.json`・`data-quality-finding-duplicate-source-archives.md`。破壊的操作（DELETE/UPDATE/VACUUM）なし。
- N1-C実行の安全境界: `data/boat.sqlite`はN1 write **0**（read-only fingerprintのみ、byte identityは並行racer-stats appendでFAILだがstructural/schema/app_settings identityはPASS）。フル実行中に並行racer-stats appendでstrict guardが`PRIMARY_DB_CHANGED`安全停止（1,059で破損なし）→structural監視でresume完走。shadow writer/GC/collector/production/自動投票は全OFF。
- N1-C後のgate（2026-07-30 audit更新）: **quotaは30GB適用済み**で現DB≈9.02GBに対し充足（daily incremental ≈1.16MB/day・≈0.42GB/year → 数十年headroom、quota/disk不足はblockerでない）。GC・大規模追加ingest前にdisk low-water 16→24GB化を推奨（precondition、blockerでない）。operational GC有効化は専用readiness gate（`docs/n1-settlement-gc-safety-contract.md`）+別承認、future collector/N2は別承認。運用readiness/監査の正本は`docs/n1-operational-readiness-audit.md`、N2着手前チェックは`docs/n2-readiness-gate-checklist.md`。
- N1-C acceptanceは現在 **CONDITIONAL / CI_INFRA_BLOCKED のみ**（body verification debt=0、全local gate PASS）。remote CI（GitHub Actions）が runner allocation failure（runner=""、steps=0、GHA globally operational→account-level minutes/billing疑い、未確定）で workflow を実行できないことだけが唯一の formal blocker。復旧後 HEAD で CI success すれば docs-only promotion で COMPLETE。
- **N2 readiness（2026-08-01、feature builder着手準備のみ）**: `N2_IMPLEMENTATION_READY=YES` はlabel truth/dataset/model完成を意味しない。archive parser v1には「特払い」をrace-wide返還にして後続正常払戻まで100円返還化する確定bugがあり、`n1-settlement-parser-v2`で不成立と特払いを分離済み。v1/v2全archive read-only差分scannerも実装済みだが、raw archive未接続のため319,301 excluded_refundedとeligible era drift 87%→99.9%の訂正値は未確定で、既存profileを学習truthに使わない。正本 `reports/n2/archive-refund-semantics-audit.md`。
- **N2 target contract v2 / selection profile（2026-08-01）**: 全7券種212 canonical selectionを`deriveSelectionLevelLabels`へ通し、`buildN2SelectionProfile`でoutcome/class balance/hit率/正の払戻分布/digestを集計する。矛盾するfinancial truthはfail-closed。`profile:n2:selection-labels`はimmutable DBをcloseを挟んで独立2回openし、入力再読込一致を検証する。隔離SQLite E2E fixtureは4 candidates/120 selectionsでPASS、profile tests 4/4・targeted strict typecheck PASS。実sidecar profileは未実行で、実行してもarchive v1訂正前は`STALE_ARCHIVE_SEMANTICS`扱い。
- **N2 odds atomic PIT guard（2026-08-01）**: 旧`validateOddsUsage(kind, role)`はlive checkpointの実時刻を検証せず未来oddsを許可できたため廃止。`kind / role / capturedAt / availableAt / decisionCutoff`を単一inputで検証し、capture/availabilityのcutoff超過、availableAt>capturedAt、欠損・不正時刻をfail-closedにした。closingは妥当な時刻を持つevaluation専用。contract tests 12/12・targeted strict typecheck PASS。selection builderへ接続済み、実DB adapterは未接続。
- **N2 feature dataset builder scaffold（2026-08-01）**: `buildN2FeatureDatasetRows`でeligible candidateを全selection行へ展開し、label・feature/PIT/provenance・selection odds/atomic PITを一体化した。known live-only keyのclass laundering、未来/重複/provenance欠損/非canonical odds/必須selection欠損はcandidate全体0行でfail-closed。builder tests 8/8・targeted strict typecheck PASS。source adapter契約は実装済み、real lineage join・coverage/provenance report・永続dataset・trainingは未接続。
- **N2 verified feature lineage（2026-08-01）**: IDが非空なだけの旧adapter契約では任意文字列をprovenanceへ昇格できたため、`n2FeatureLineage.ts`を追加。F0 `domain_observations → parse_runs → raw_documents`のread-only JOIN結果に対しrace/type/raw chain、parse success、integrity/security/replay eligibility、official source、時刻順序を検証した`n2-feature-lineage-v1`だけをadapterへ渡す。oddsはcaptured_at=source_observed_atも必須、available_atはverified evidence由来。lineage tests 6/6・adapter tests 7/7・targeted strict typecheck PASS。`official_program` typed契約は後続で追加済みだが、実collector observationと全券種market observationは未整備なので、実join率は未確認。
- **N2 feature coverage/provenance profiler（2026-08-01）**: `n2FeatureCoverage.ts`でrace×source kind×keyを固定分母とし、年代/feature別verified・excluded・coverage・provenance完備・unique observation/raw・availability basis・除外理由・決定的digestを集計する。重複分母と不完全provenanceはfail-closed。`profile:n2:feature-coverage`は実event 0件を`PENDING_REAL_DATA`+exit 2、fixtureを`FIXTURE_ONLY`とする。tests 6/6・targeted strict typecheck・CLI pending smoke PASS。この時点で未実装だったsidecar event生成は、後続のimmutable readerで接続済み。
- **N2 immutable feature coverage reader（2026-08-02）**: `n2FeatureCoverageReader.ts`でprimary DBとF0 sidecarを`immutable=1/readOnly`で別接続し、公式番組1raceあたり42 feature分母を生成する。旧readerがF0正本`YYYY-MM-DD:venue:RraceNo`ではなく`YYYY-MM-DD:venue:2桁raceNo`を生成し、実joinを常に0件にする契約不一致を修正。primary race identityを厳密検証し、唯一のverified `official_program`証拠鎖だけを昇格、evidence 0/複数/不適格・feature欠損は理由付き除外とする。隔離SQLite E2Eは3/3 PASS（2004:42/42、2026 lineageなし:0/42、ambiguous拒否、実行前後DB SHA-256一致）、targeted strict typecheck PASS。CLIは`--primary/--sidecar/--from/--to`を受ける。実DBはこの環境にないため実join率は未確認。
- **N2 official-program typed observation（2026-08-02）**: F0 registryへ`official_program / pre_race`を追加し、canonical race key、source observed時刻、course 1〜6が一意な1〜6艇、登録番号・級別・全国/当地勝率/2連率・motor/boat 2連率をexact-key/範囲検証する。不足艇は保持しcoverageで明示除外、未知field、重複course、非canonical identity、不正時刻はfail-closed。golden fixture hash=`06be00c42eaaaa9f5845d29e7af30a49740bc02b6f3694bcfe3afac7558cdb82`。後続のparser/reconciliation実装を含む現在の検証結果は次項を正本とする。
- **N2 official-program parser / primary reconciliation（2026-08-02）**: 共通`programFeatures` parserが`Number(null/空文字)=0`として欠損rateを0へ誤変換するbugを修正し、欠損をnullのまま保持する回帰testを追加。`n2OfficialProgramObservation.ts`でnumeric string/null、course順、canonical identity、source時刻順序を正規化した`n2-official-program-parser-v1` envelopeを生成する。coverage readerはlineageに加えtyped payloadのdomain/typed schema・hash・identity・observed_atとprimary rawのsemantic一致を必須化し、欠落/差異を42 featureの明示除外へ落とす。対象tests 17/17・targeted strict typecheck PASS。実sidecarへのcollector writeと実coverageは未実行。
- **N2 official-program F0 ingest E2E（2026-08-02）**: `ResearchReplayRepository`へ保存済みraw bytesを再読込する共通typed parser経路を追加し、`ingestOfficialProgramObservation`を接続した。primary `raw_json`のbyte列をcontent-addressed raw evidenceとして保持し、生成envelopeをraw原本へ置換しない。正常rawはtemp F0 sidecarのparse/domain/typed payloadを経てimmutable coverage readerで42/42 verified。不正rawはerror parse runだけを残し、observation/payloadのpartial writeは0。新規E2E 2/2、関連回帰込み9/9、targeted strict typecheck PASS。live collector writerはOFFのままで、実sidecar coverageは未確認。
- **N2 official-program capture lineage E2E（2026-08-02）**: temp adapterでrequest開始からtyped payloadまで五層lineageを接続。repositoryがevent時刻逆行、body byte count欠落/実raw不一致、body event所有関係、link時刻を拒否する。URL/header secretを除去し、parse errorを取得失敗と混同しない。collector E2E 3/3、関連回帰込み12/12、targeted strict typecheck PASS。実collector/sidecar writerはOFF、実coverageは未確認。
- **N2 immutable trifecta odds coverage reader（2026-08-02）**: F0 typed registryでlive bet typeが明示される`trifecta_market`だけを対象に、指定checkpoint×120 canonical selectionを固定分母化した。legacy `odds_timeseries_snapshots`は49M行あってもbet_typeなしのため昇格しない。payload type/schema/hash、F0証拠鎖、observed_at、selection重複/範囲を検査し、欠損はselection別excluded、同一checkpoint複数観測は全件ambiguousで拒否する。隔離SQLite E2E 4/4・targeted strict typecheck PASS、両DB SHA-256一致。CLIは`--source=trifecta-market --checkpoint=T-5`。実F0 coverageと全7券種live observationは未確認/未整備。
- 現行formalは`legacy_t5_formal / legacy-t5-v1 / formal_forward`の固定benchmark、新方式は`market_intelligence / shadow_forward`として評価系列を分離する。

## 絶対にしてはいけないこと

- `data/boat.sqlite`への`INSERT / UPDATE / DELETE / DROP`
- 明示承認なしのresearch sidecar writer/GC有効化
- readiness実行内でhuman approvalを生成・補完・推測すること
- `app_settings`変更
- 本番decisionロジック・モデル閾値・BudgetRule変更
- 自動投票、投票サイト操作、ログイン情報保存
- `data/`や`backups/`の削除
- BUYを「買えば利益になる」と説明すること
- current oddsだけを実収益として評価すること
- 修正前317件を正式なnetwork-only T-5標本として扱うこと

DB compact候補を作るスクリプトは存在するが、エージェントは実行しない。原本切替・DELETE・VACUUMは人間の保守作業である。

## 2026-07-21に確定した問題と修正

### 収集母集団

旧実装はモデル候補から収集raceを作り、候補が無い公式番組を落とし得た。現在は`official_programs`の当日全raceを直接母集団にする。

### T-5取り逃し

- JST 08:00〜21:05に収集
- 締切が近いraceから処理
- 収集は締切1分前まで継続
- BUY通知は実残り5分以上を別gateとして維持
- 同一race/checkpointの完全市場は再取得・再保存しない
- 欠場は「有効オッズ＋欠場セル＝120」で構造的完全とする

### 保存時刻の誤り

通信開始前に決めた残り分数/checkpointを保存していた。現在は公式応答後の実時刻で再計算し、締切後に届いた応答は保存しない。

### checkpointキャッシュ汚染

T-10等で保存した5分キャッシュをT-5として再利用し得た。未完成checkpointは必ず公式networkから再取得し、実行ログへ`source=network`を出す。

### 遅延

公式通信を締切順・上限2件で並列化した。本番確認値:

- 判断開始遅延: 62.993秒 → 37.574秒（40.35%減）
- 全体: 85.020秒 → 57.917秒（31.88%減）
- 15:17 JST実行: 7件すべてnetwork、失敗0、終了コード0

ただし、後段decisionはジョブ開始時の`now`をまだ使う。約37秒の時刻差が残るが、本番decision変更禁止のため未変更。

### 通知とURL

- BUY通知はT-5ラベルだけでなく送信直前・各送信ループで実残り5分以上を確認する。
- 公式オッズURLは日付・場コード・race番号付きのBOAT RACE公式URL。
- 投票入口は公式案内にある`https://bu.tbbr.jp/`。自動投票はしない。

## 現在の実測

ユーザー報告時点（2026-07-23 13:12 JST）:

- 当日paper-live: BUY 3 / WATCH 8 / SKIP 49（13:11 JST、BUYは購入指示ではない）
- network-only正式cohort: T-5完全231/275、84.00%
- 当日途中: T-5完全49/59、83.05%
- 完了日の日次80% gate: 1/3日
- 新規保存重複率: 7月22日1.00x、7月23日途中1.00x
- 7月23日の収集エラー: 早朝3件。直近ログの各実行は`failed=0`、launchd終了コード0
- 全テスト: 373 pass / 0 fail
- 型検査・本番build・`git diff --check`: PASS

今回再実行時点:

- 当日paper-live: BUY 5 / WATCH 13 / SKIP 87（16:24 JST、開催進行による自然増加）
- collector監査: network-only T-5完全278/322、86.34%（16:22 JST）
- forward監査: network-only T-5完全281/325、86.46%（16:30 JST、収集ジョブ並行稼働中のため自然増加）
- formal settled: 52/1,000で不変。市場ROI64.23%、最大1的中除外40.98%、最大2的中除外29.60%
- 同一50レース: T-5市場ROI66.80%・logloss 3.7344、2023–2024履歴ROI75.20%・logloss 4.2723
- 事前校正の混合係数はα=0。全gate BLOCKED
- paper-live BUY結果確定は5件、的中0、100円×5件の仮想損益は-500円
- 7月23日早朝の一時取得失敗は鳴門1R・唐津1R・芦屋2Rの3件。各2回再試行後も失敗し、当該レースのcheckpointは未保存なので欠測として残る。その後の直近実行は`failed=0`
- launchd `com.boatpon.auto-odds`は終了コード0。7月22日・23日の保存重複率は1.00x

13:12から16:24の差は、当日レースの締切進行と収集ジョブの継続による自然増加である。formal settledは増えておらず、結果再取得、重複race、集計定義変更による増加は確認されていない。

収益性:

- 現行BUY: 推定的中率4.01% / 実績1.97% / 実払戻ROI69.32%
- 純T-5市場forward: n=114 / ROI60.53% / 最大2的中除外44.38%
- 残差モデル: train ROI145.67% / forward ROI72.81%、logloss/Brierも悪化
- network-only正式cohort: 結果確定52/1,000。市場ROI64.23% / 最大2的中除外29.60% / logloss 3.7434 / Brier 0.9516
- 2023-2024固定履歴モデル比較: 番組・展示まで揃う同一50レースで履歴ROI75.20%だが、市場ROI66.80%を含め両方赤字。事前校正で選ばれた混合係数はα=0で、履歴特徴の追加効果なし
- 正式gate: network-only T-5 settled 1,000件が必要

結論は次の意味に固定する。2023–2024履歴データは、比較、診断、候補モデル構築には利用できる。しかし現在のforward条件では、T-5市場確率へ追加する増分予測価値は確認できない。事前校正ではα=0が選択されており、現時点では履歴モデルを市場確率へ混ぜない方が良い。50レースは小標本で、両ROIは100%未満、履歴loglossは市場より悪く、市場ROIも少数の高配当に依存して最大2的中除外で29.60%まで低下する。formal settled 52/1,000では正式判断に不足する。

上記ROIは現行が不合格だという参考根拠にはなるが、修正前T-5にはキャッシュ鮮度の未証明がある。新モデルの合否判定にはnetwork-only future cohortだけを使う。

## DB肥大化

- DB全体: 13.98GiB
- 時系列: 48,896,342行
- race/checkpoint/selection一意: 1,147,183
- 重複相当: 47,749,159行
- 旧重複率: 最大52.02x
- 修正後: 約1.07x
- compact計画: 48,875,702行 → 1,133,023行（2.32%保持）
- 完全市場保持: 9,342/9,342 PASS
- 推定: 13.98GiB → 6.04GiB、約7.94GiB回収

圧縮計画と検証器はあるが、候補DB作成・fingerprint検証・atomic切替は未実施。原本DBを直接変更しない。

## 作業開始時の確認コマンド

すべてリポジトリ直下`/Users/m-shogo/Developer/personal/boat-pon`で実行する。

```bash
pnpm handoff:ai
git status --short
pnpm exec tsx scripts/auto-fetch-odds.ts --dry-run
pnpm audit:t5-collector-efficiency
tail -n 40 data/logs/auto-odds.log
launchctl print gui/$(id -u)/com.boatpon.auto-odds
```

DB確認が必要なら読み取り専用/immutableで行う。

```bash
sqlite3 'file:data/boat.sqlite?immutable=1' \
  "SELECT decision,COUNT(*) FROM decision_history WHERE date=date('now','+9 hours') AND run_kind='paper-live' GROUP BY decision;"
```

検証:

```bash
pnpm test
pnpm typecheck
git diff --check
```

## 次に進める順序

Phase N0は完了。N0後の順序・研究境界は`docs/research-platform-master-plan.md`、研究台帳は`docs/research-idea-register.json`を最上位正本とする。N0の実測は`reports/all-bet-type-data-feasibility.md/json`、取得設計は`docs/all-bet-type-data-acquisition-design.md`、schema案は`docs/all-bet-type-schema-migration-design.md`を詳細正本とする。

Phase N0の確定事項:

- 公式結果ページと既存公式日次成績cacheには7券種の払戻がある。
- 現DBの払戻はexacta / quinella / wide / trifecta / trioのみで、win / placeは0件。
- 現行live時系列は`bet_type`なしの3連単専用。全券種を混在させない。
- place / wideはrange oddsとして保存する必要がある。
- 売上額・投票口数は公式source未確認でBLOCKED。
- `official_programs.raw_json`にはレース当時の登録番号、級別、全国/当地勝率・2連率があり、`race_entries`にはstrict-prior再構築の正本となる実進入、実ST、着順、事故codeがある。
- `racer_profiles`と`racer_course_stats`は現在値1世代で、`fetched_at`は値の有効時点ではない。historical raceへ直接JOINしない。
- `racer_course_stats`は全course rowで`races=0`、`win_rate`欠測で、集計期間・標本数・分散を再現できない。現在のlive表示以外の正本にしない。
- コース別能力、直近30/90走、F後日数、開催内前走、過去同走・直接対戦、戦法proxyは、対象raceより前の`race_entries`だけから再構築可能である。
- 級別等の有効期間、全国/当地3連率、事故率、当日体重・展示・部品交換推移はN3のsnapshot/append-only観測、recent/pair/style派生値はN4のstrict-prior再構築として設計した。
- 選手PIT項目別判定は監査JSONの`racerAudit.featureMatrix`、保存案はschema設計の`racer_profile_snapshots`等6候補を正本とする。今回migrationは適用していない。
- 独自研究7軸はすべて`CONDITIONAL`。項目別判定は監査JSONの`researchAxisAudit.axes`を正本とする。
- 公式情報の市場反映遅延は現行latest rowと`fetched_at`だけでは再現不可。`source_published_at`と観測/first-seen時刻、raw hash、変更versionが必要でfuture-onlyである。
- 全券種市場整合性は現在3連単時系列だけ。N2で5画面の各応答時刻・range・発売状態・raw矛盾を保存するまで、120状態へ同時点市場として投影しない。
- 1マークは展示と結果の時系列・共起proxyまで再構築可能だが、公式telemetryがない「攻撃艇」「隣接艇を潰した」は判定不能とし、主観補完しない。
- 有望な上位3軸はError Atlas、strict-prior潜在水面evidence、選択的不確実性。いずれも監査・保存設計だけでmodelは未実装。
- 独自研究軸の保存候補は`official_information_observations/changes`、`market_observation_batches`、projection audit、uncertainty snapshot、venue-day evidence、Error Atlas。今回migrationは適用していない。
- 既存DB、`app_settings`、launchd、collector頻度、予測/判定は変更していない。

1. 現行`legacy_t5_formal`はfixed enrollment protocolのprospective cohortとして、条件を変えずmembershipをappendする。報告・common comparison時にfrozen analysis snapshotを別作成する。
2. Stage F0はsidecar schema `f0.1.0`、五層lineage、immutable capture lifecycle、raw/semantic二重判定、raw security、canonical identity、checkpoint freeze、versioned resolver、単方向supersession、FC08A/FC14A、golden fixtureまでtemp DBで実装済み。証跡は`docs/research-replay-foundation.md`と`reports/research-replay-foundation.json`。
3. F0-Rで`data/research-replay.sqlite`へexpand-only schemaをrolloutし、FC08B/FC12/FC14Bを検証した。`data/boat.sqlite`はread-only fingerprint監査のみ。shadow writer/GCはOFF、live collector未接続である。
4. N1-A offline foundationは完了した。公式K archive 8,164件は全件parse成功し、1,194,007 race、11,514,006 payout lineを再構築した。Legacy fixture照合は主line 720件一致、N1 only 720件、payout mismatch 0。
4b. N1-Bで`n1-settlement.0.1`を永続sidecarへzero-dataで適用した（明示承認`N1_PERMANENT_SETTLEMENT_SCHEMA_ROLLOUT`、backup→migration→post-gate→restore-copy canary）。容量benchmarkでfull backfill ≈10.5GBが1GiB quota超過、evidence pin ≈23M行の重複を確認。N1-Cはquota引き上げ＋evidence pin Option B＋別承認まで開始しない。正本`docs/n1-settlement-permanent-rollout.md`。
5. 新方式は`market_intelligence / shadow_forward`として、manifest、decision、ticket、cohort、ROI、gate、reportをLegacyから分離する。
6. model学習はN5開始gate、production検討はN8と独立production gateまで行わない。
7. DB圧縮は人間の明示承認後、runbook通り別候補DBで実施する。

2023-2024固定履歴モデルと市場の比較器は実装済み。現時点ではα=0が選ばれたため、特徴量追加や本番接続へ進めず、同じ固定条件のformal future蓄積を続ける。

全体順序は`docs/research-platform-master-plan.md`、市場モデル詳細は`docs/market-residual-ticket-selection-roadmap.md`を正本とする。順序は`Stage 0 → F0 → F0-R → N1 → D1 → N2 → N3 → N4 → D2 → E1 → E2 → N5 → N6 → N7 → N8`。D1までにcohort lifecycle/evaluation/taxonomyを固定し、D2/E1前にResearch Hypothesis Registry、N5前に別のModel Experiment Registryを凍結する。未登録D2/E1/E2分析はexploratoryとする。

## やっても改善にならないこと

- BUY件数だけ増やす
- 過去データへ特徴量を大量追加し、同じholdoutを繰り返し見る
- current odds ROIで黒字に見せる
- T-5/T-10/closing oddsを混ぜる
- 複数`captured_at`のunionで完全市場を作る
- 高配当1〜2件依存を無視する
- 修正前T-5とnetwork-only T-5を同じ正式母集団にする

## 主な実装・資料

- `src/research-replay/` — F0 sidecar schema、raw store、typed observation、resolver、manifest、PIT guard、canary
- `scripts/research-replay.ts` — temp既定のF0監査CLI
- `src/research-replay/rollout.ts` / `readiness.ts` — F0-R outbox、failure isolation、GC、backup/restore、readiness
- `scripts/research-replay-rollout.ts` — F0-R dry-run/sidecar readiness CLI
- `tests/fixtures/research-replay/` — sanitized golden fixture
- `docs/research-replay-foundation.md` — F0 architecture/security/runbookとcontract result
- `docs/research-replay-rollout.md` — F0-R rollout/rollback正本
- `reports/research-replay-foundation.md/json` — F0実測
- `reports/research-replay-rollout-readiness.md/json` — F0-R実測

- `scripts/auto-fetch-odds.ts` — 公式番組母集団、時刻再計算、network-only、並列収集、通知
- `src/domain/liveOddsFetch.ts` — 締切順、完全checkpoint、並列上限制御
- `src/domain/buyNotification.ts` — T-5＋実残り時間の通知gate
- `src/domain/buyResultNotification.ts` — paper BUYの的中/外れ、公式払戻、100円仮想損益を結果確定後に通知
- `scripts/analyze-historical-ranking-forward.ts` — 2023-2024固定学習、2025/2026 forwardと重み成果物
- `scripts/audit-t5-historical-market-forward.ts` — 固定履歴モデル・T-5市場・事前固定混合を同一formal raceで比較
- `scripts/audit-t5-collector-efficiency.ts` — 修正後/network-only cohort監査
- `scripts/audit-t5-market-baseline.ts` — 市場baseline
- `scripts/analyze-t5-residual-forward.ts` — 残差forward検証
- `scripts/audit-odds-timeseries-storage.ts` — DB肥大化監査
- `scripts/plan-odds-timeseries-compaction.ts` — compact計画
- `scripts/verify-odds-timeseries-compaction.ts` — 原本/候補fingerprint比較
- `scripts/build-compact-odds-candidate.ts` — 人間専用の候補DB作成器。エージェント実行禁止

## 作業ツリー上の注意

本タスクの差分はcommit・pushしてcleanにする。次回開始時は`git status --short`と`git rev-parse HEAD origin/main`を再確認する。その後に新しい未追跡・変更済みファイルがあればユーザー所有として扱い、広範なrevert・reset・checkoutをしない。

`pnpm handoff:ai`のguard結果と実運転状態は分けて確認する。収集ジョブはlaunchdの終了コードと`data/logs/auto-odds.log`を正本にする。

## 2026-08-02 N2 official_program retry/dedup

completed:

- 同一公式番組rawを再取得すると、raw自体はdedupされてもparse/domain observationが毎回追加され、同一raceのlineageが複数件となって42 featureすべてambiguous除外になる不具合を再現した。
- `ResearchReplayRepository.findReusableTypedObservation`を追加し、同一canonical race・raw・parser/source schema・payload typeの未supersede成功証拠が一意で、parse/domain/typed hashとschemaが一致する場合だけ既存parse/observationを再利用する。
- retryのcapture attempt/event/raw linkは各回分を保持する。same-race retry fixtureは2 attempts / 2 links / 1 raw / 1 parse / 1 observation。rawが同じでも別raceなら再利用せず2 observations。
- collector E2E 5/5、program ingest/parser/coverage/odds回帰込み21/21、targeted strict TypeScript PASS。
- code commits: `20b2b55a59c7bf050725ea1f0a87a378b0216ebe`, `1f5bd37f0a60d5af303711cadfa6569c18331ab2`, `ffe26203f9638f0e364faec56366587606701f18`。

current / blocked:

- `ARCHIVE_REFUND_SEMANTICS_AUDIT`のparser/label修正とscannerは実装済みだが、raw archive/実sidecarがこの実行環境になく、year × bet_type × event_kind、約319,301候補、eligible 87%→99.9%のread-only再集計は未完了。既存profileはtraining truthへ昇格しない。
- official_program live writerはOFF。今回のadapterはtemp/offline境界のみで、実collector・primary DB・production decisionを変更していない。

next:

1. raw archive/実sidecarへ到達できればrefund scannerとcanonical reconciliationを最優先で実行する。
2. 到達できなければ、capture failure→新attempt retry成功のfailure isolation、single-writer境界、shadow writer rollback/circuit breakerをtemp E2Eで固定する。
3. 実writer接続は明示gate、backup/restore、canary、primary collector非伝播を満たすまで行わない。

### Capture failure retry isolation

- `recordOfficialProgramCaptureFailure`を追加し、network/timeout/partial-body系失敗をrawのないterminal capture attemptとして記録する。
- schemaの`capture_event_no_after_terminal` triggerが失敗後のbody追加を拒否することをcollector fixtureで明示検証した。retryは同じlogical groupの新attemptで、失敗履歴を上書きしない。
- E2E: failed 1 + succeeded retry 1 / link 1 / raw 1 / parse 1 / observation 1。collector 6/6、今回の関連回帰12/12、strict TypeScript PASS。
- F0-Rにはprimary失敗非伝播、idempotent outbox retry、rollback/kill switchが既にあるため、新しい並行機構は作っていない。
- commits: `8861a3963e961695c1c34f0109f1bcb7ffe5d425`, `fd1a1077f91cf57a27852b986632ed03bbc22a27`。

next: raw入力があればarchive refund scannerを最優先。なければofficial_program shadow outbox message contractとsingle-writer/idempotency keyをtempで接続し、primary collectorへ失敗が伝播しない統合E2Eへ進む。live writerはOFF。

## 2026-08-02 N2 official_program shadow outbox

completed:

- `n2.official_program.capture.v1`を既存F0-R outboxへ接続した。
- outboxはraw本文を複製せず、primary record ID、期待SHA-256、canonical race/capture時刻、redact済みURL、allowlist済みheaderを保持する。
- consumerはprimary rawを再読込し、byte hash一致前にはcapture attemptを含むsidecar evidenceを一切作らない。
- idempotencyはrace × request_started_at × raw hash。同一attemptは既存messageを返し、別時刻retryは別messageとなる。
- temp E2E: default OFF、exact retry idempotency、一回配送、primary raw改変fail-closed、backpressure primary非伝播の5/5 PASS。関連program/coverage回帰込み17/17 PASS、targeted strict TypeScript PASS。
- code commits: `d4c07b0d2524bf744b3d7f49d216c4c746a23dd5`, `c8c1cd2b24ba361da5af60b261359bc30374d9df`。

current / blocked:

- live writerはOFF。実DB、primary collector、予測、BUY条件は変更していない。
- archive raw/実sidecarが未接続のためrefund scanner実数、約319,301候補、eligible率差、実coverageは未確認。既存N2 profileはtraining truthへ昇格しない。

next:

1. raw archiveへ到達できればrefund scannerとcanonical reconciliationを最優先で実行する。
2. 入力がなければ、outbox consumerのmixed message routing、permanent failure/circuit breaker、kill-switch rollbackをtemp統合で固定する。
3. 実writer接続は明示approval、backup/restore、canary、primary非伝播、rollback rehearsalが揃うまで行わない。

## 2026-08-02 mixed shadow routing / rollback

completed:

- F0-R `drain`へ明示的なpermanent failure分類を追加した。
- `ShadowMessageRouter`を追加し、message typeごとに一意のhandlerへ配送する。duplicate登録は拒否する。
- unknown typeとmalformed official_program payloadは初回でpermanent failure。capture evidenceを作らずretry枠も消費しない。
- 通常のhandler例外は従来どおりbackoff retryし、次回成功できる。
- rollback後はshadow OFF＋kill switch ONとなり、queue/historyを保持したままdelivery 0件。
- routing E2E 5/5、official program/coverage回帰込み22/22、targeted strict TypeScript PASS。
- code commits: `ee867b5d44d12a54455857601aa512f88c4684a7`, `f4277414bbb33a571c03a90e7c13fd52bec1fab9`, `05e22bad37100ed29ad366acf9ddafffe80e00a2`, `c047684e6f676759618ec7916b5d1ac4dae1b512`。

current / blocked:

- raw archive/実sidecar未接続。約319,301候補、year × bet_type × event_kind、eligible率差、実coverageは未確認。
- live writer、実DB、primary collector、予測、BUY条件は変更していない。

next:

1. raw入力があればarchive refund scannerとcanonical reconciliationを最優先。
2. 入力がなければoutbox delivery lease/claimの並行consumer競合を監査し、二重配送を防ぐsingle-writer claimをtemp E2Eで固定する。
3. 実writer接続はapproval、backup/restore、canary、rollback rehearsal完了まで行わない。

## 2026-08-02 shadow delivery single-writer claim

completed:

- F0-R outboxの候補read→handler→attempt append間で、二consumerが同一messageを二重配送できる競合を再現・修正した。
- messageごとに`BEGIN IMMEDIATE`を取得し、lock後にconfig、terminal state、availabilityを再読込する。
- handlerとdelivery attempt appendを同一transaction境界に置き、競合consumerはdelivery/failure attemptを作らずskipする。
- typed observation内部の`BEGIN IMMEDIATE`をsavepointへ変更し、通常実行とclaim transaction内実行の両方を維持した。
- 二接続fixture: A delivery 1 / B delivery 0 / attempt 1。A一時失敗時もB 0 / retry attempt 1。
- claim/official program/coverage関連24/24、targeted strict TypeScript PASS。
- code commits: `56c09addf070c1e4092ac4b15312b06caf663c69`, `f74a2d1f2669aef9267f7acb1ef57b3b968cf1f4`, `798a8d251fbc1a1d6efc04762929c5630dc0cc0c`。

current / blocked:

- raw archive/実sidecar未接続。refund実数、約319,301候補、eligible率差、実coverageは未確認。
- live writer、実DB、collector、予測、BUY条件は変更していない。

next:

1. raw入力があればarchive refund scannerとcanonical reconciliationを最優先。
2. 入力がなければhandler長時間化・busy contentionのbounded observability、process crash後のclaim rollback/replayをtemp subprocess E2Eで固定する。
3. 実writerはapproval、backup/restore、canary、rollback rehearsalまでOFF。

## 2026-08-02 F0-R contention observability / process-crash replay

completed:

- 既存`drain`契約を維持したまま、`drainWithDiagnostics`で`examined / contended / skippedAfterClaim`を返し、queue空とwrite-lock競合を区別可能にした。
- 二接続reentrant fixtureはnested consumerでexamined 1 / contended 1 / delivery 0 / failure attempt 0。
- 別Node processをhandler transaction中に`process.exit(77)`で終了するE2Eを追加。未commit handler audit row 0、delivery attempt 0、再open後queued 1、再配送success 1を確認した。
- claim/crash/official program/coverage/odds/routing関連32/32、targeted strict TypeScript PASS。
- code commits: `6f83749c76acd725f93067a610a55619800a98f7`, `f9b256b94ecf26b839e3da9b8041c9eaa31a53a2`, `cf6abeeb18221d653b61b646bca263b78b419e1c`。

current / blocked:

- raw archive/実sidecar未接続。refund実数、約319,301候補、eligible率差、実coverageは未確認。
- live writer、実DB、collector、予測、BUY条件は変更していない。
- 実sidecar複数process canaryと承認済みcrash rehearsalは未実施。

next:

1. raw入力があればarchive refund scannerとcanonical reconciliationを最優先。
2. 入力がなければdiagnostic countersをshadow health snapshotへ安全に集約する境界と、handler wall-time budget/cancellation契約をtemp E2Eで固定する。
3. 実writerはapproval、backup/restore、canary、rollback rehearsalまでOFF。

## 2026-08-02 F0-R atomic handler / deadline boundary

completed:

- handlerが同じSQLite transactionへ部分書込み後に例外を投げると、旧実装がretry attemptと一緒に部分writeもcommitし得る不具合を確定・修正した。
- handler専用savepointを追加し、例外・deadline超過時はhandler DB side effectをrollbackしてからfailure attemptだけをappendする。
- 既定30秒、1ms〜300秒のmonotonic wall-time budgetと協調`throwIfCancelled`、return後deadline確認を追加。
- deadline超過は`SHADOW_HANDLER_DEADLINE_EXCEEDED`としてretry分類。同期handlerの外部preemptionは保証しない。
- `recordDrainDiagnostics`は整合性検証済みcounter＋healthだけをsnapshot化し、message payloadを保存しない。
- 関連35/35、targeted strict TypeScript、whitespace check PASS。
- code commits: `07f6eaa195688234c5fb3fe1698d15641756d4a2`, `a08ec10388505eeac71536185fc5bc3676684187`, `8ae7b9eab67d5e1f358513a8b4d4c7e139fcf296`。

current / blocked:

- raw archive/実sidecar未接続。refund実数、約319,301候補、eligible率差、実coverageは未確認。
- live writer、実DB、collector、予測、BUY条件は変更していない。
- DB外部副作用handlerはrollback不能なため未許可。別の冪等/reconciliation契約が必要。

next:

1. raw入力があればarchive refund scannerとcanonical reconciliationを最優先。
2. 入力がなければoutbox滞留・retry exhaustion・contention/deadline counterをまとめるread-only operability reportとthreshold gateを実装する。
3. 実writerはapproval、backup/restore、canary、rollback rehearsalまでOFF。


## 2026-08-02 F0-R read-only operability gate

completed:

- retry上限到達を固定`SHADOW_RETRY_EXHAUSTED`で保存し、明示的permanent failureと設定変更後も区別可能にした。
- `shadowOperability.ts`を追加。outbox backlog/ready/age、retrying、permanent、retry exhaustionと、指定windowのcontention/deadline診断をread-onlyで集約する。
- threshold値はproduction推測を避け、versioned policyとしてcaller必須入力。PASS/WARN/BLOCKED理由と決定的digestを返しpayloadは出力しない。
- exact marker、集計、threshold、digest再現、read中write 0、malformed診断fail-closedを含む新規3 testsがPASS。関連対象18/18、targeted strict TypeScript PASS。
- code commits: `94cb22a1a7c582cf41aaa7e2964230c68173196b`, `ee923bd93bda0676cee8ff2f97895c4c85013d7c`, `55bc0305a8cd7342b2814f484846c964310367bb`。正本同期は`b4db2f3f6a44b4fc129b858a8174dfb8b480f37f`まで。

current / blocked:

- raw archive/実sidecar未接続。refund実数、約319,301候補、eligible率差、実coverageは未確認。
- live writer、実DB、collector、予測、BUY条件は変更していない。
- 実運用thresholdは未承認。fixture thresholdをproduction policyへ昇格しない。

next:

1. raw入力があればarchive refund scannerとcanonical reconciliationを最優先。
2. 入力がなければoperability reportのimmutable/read-only CLIと、実sidecar policy file schema/approval境界を実装する。
3. 実writerはapproval、backup/restore、canary、rollback rehearsalまでOFF。


## 2026-08-02 F0-R immutable operability CLI / approval binding

completed:

- strict `shadow-operability-policy-v1` decoderとJSON Schemaを追加。thresholdの暗黙default、unknown field、範囲外値を拒否する。
- policy digestを既存F0-R approval grant/lifecycle resolverへ結合。未承認、simulated approvalのproduction利用、revoked、policy改変をBLOCKEDにした。
- immutable/read-only/query-only CLIを追加し、active WALがあるDBは拒否してquiescent snapshotだけを受け付ける。exit codeはPASS 0 / WARN 2 / BLOCKED 3。
- 新規4 testsを含む対象7/7、targeted strict TypeScript、JSON構文、whitespace PASS。
- code commits: `786f3a328657465430c766564991e842df7aea2c`, `bcc58588743babfadadf255594d027460c922f47`, `18700b19d2d0391e6082106854637158d11d1f39`, `e737facd53e5dd3ea5283ccf43d390d7ce9b62e8`, `f72df68aeb626f4aa021760487392cb249a2aafe`。 正本同期は`e8868e689d76491e681e5dd7032d995626c3401f`まで。

current / blocked:

- raw archive/実sidecar未接続。refund実数、約319,301候補、eligible率差、実coverageは未確認。
- production policy値とproduction approvalは存在しない。fixture値を流用しない。
- live writer、実DB、collector、予測、BUY条件は変更していない。

next:

1. raw入力があればarchive refund scannerとcanonical reconciliationを最優先。
2. 入力がなければoperability evidenceへsidecar snapshot SHA-256/size/schema identityを結合し、異なるsnapshotで同じmetrics digestになる曖昧性を解消する。
3. 実writerはapproval、backup/restore、canary、rollback rehearsalまでOFF。

## 2026-08-03 archive refund full scan + canonical reconciliation（Track A 完了）

completed:

- **raw K archive を発見**: `data/raw/official/results/k*.lzh`（8,174 files、2000-01-01〜2026-08-01、Git管理外）。43GB `data/raw/kyotei24` も存在。`unar` で read-only 解凍。過去 handoff の「raw archive未接続」はこの環境では該当せず、Track A を実施した。
- **v1/v2 full scan**（`pnpm audit:n2:archive-refund-semantics`、parse errors 0）: v1 refund候補 319,309 → v2 1,558、false_refund_reclassified 317,753、special_payout_added 65,157。
- **archive↔canonical reconciler を新規実装**（`src/research-replay/n2ArchiveCanonicalReconcile.ts` core + `scripts/reconcile-archive-canonical-settlement.ts` CLI、`pnpm reconcile:n2:archive-canonical`）。archive v2 candidate を永続 sidecar の canonical active candidate（source-duplicate 624 obs 除外、superseded 0）と canonical race identity で突合し、exact_match/status_mismatch/result_kind_mismatch/archive_only/canonical_only/ambiguous_canonical/parse_failure へ fail-closed 分類。固定 contract version、immutable=1/readOnly/query_only、決定的 outputDigest、file 単位 checkpoint resume。
- **実測（決定的 digest `3055b247e9e3a283836d13de5eda81d14163f6b198fd3cb49e5414ca8d542215`、独立再実行一致）**: canonical active 8,152,599 = exact_match 7,834,852 + status_mismatch 317,747（全て refunded→settled）。result_kind_mismatch 0、archive_only 69,440、**canonical_only 0**、ambiguous 0、parse_failure 0。archive-derived 8,222,039 = exact + status_mismatch + archive_only（v1/v2 scanner の v2 count と完全一致）。coverage: exact 95.29% / archive covered 99.16% / canonical covered **100%**。
- **319,301 の意味確定**: canonical refunded ≈319,301 の **317,747 は v1 特払いbug由来の偽返還（真は settled）**、真の返還は約 1,554（v2 raw-scan 1,558 と source-duplicate 差分内一致）。v2 corrected eligible ≈ **99.98%**（旧 96.03% は誤分類込み）。era drift（87%→99.9%）は false_refund の年代分布（2005–06 約42–43K/年 → 2020年代 約100–450/年）でほぼ全量説明。
- **既存 test の pre-existing 破損を修正**: `shadowOperabilityPolicy.test.ts` の `run29/scripts/...` stale path（base 62c36af で ERR_MODULE_NOT_FOUND、CLI test が必ず失敗）を test file 相対解決へ修正。
- 新規 tests 10/10（reconciler core）、operability CLI test 修正後 4/4、full suite 565/565、targeted strict typecheck（tsc -b）PASS。
- code commits: `88a66fce…`（reconciler）, `8deec9c…`（tests）, `e6b1057…`（test path fix）, `c761f5b…`（v1/v2 scan evidence）, `e9911fe…`（reconciliation evidence）。
- **CI 復旧（重要な記録訂正）**: push 後の GitHub Actions run `30777822213` は **success**（Test/Build 含む全 step green）。従来 handoff/監査の「CI_INFRA_BLOCKED / runner allocation failure」は不正確で、実際は 2026-08-02 の `run29/` stale path test（`shadowOperabilityPolicy.test.ts`）が **Test step を exit 1 で失敗させていた**ことが原因。本工程の test path 修正でCIはHEADで green に戻った。N1-C acceptance の CI 依存 blocker はこの事実で見直し可能（governance 判断は別途）。

current / blocked:

- 実 sidecar への corrected `parser_reparse`/supersession（v1 偽返還 candidate を v2 corrected へ置換）は **別承認まで未実施**。本工程は read-only 監査で sidecar を書き換えていない。
- N2 label truth は上記 corrected candidate 置換まで READY にしない。
- live writer、実DB（`data/boat.sqlite`）、collector、予測、BUY/WATCH/SKIP、app_settings、production threshold/approval は変更していない。

next（最優先を1つ）:

1. append-only `parser_reparse` / supersession 計画を temp copy（restore copy）で検証し、v1 偽返還 317,747 candidate を v2 corrected（settled + special_payout line）へ置換する設計・canary を固める。実 sidecar への適用は明示承認・backup/restore・canary・primary非伝播が揃うまで行わない。

## 2026-08-03 settlement reparse temp-copy + 承認パッケージ（実適用は未承認）

completed:

- **append-only settlement reparse を実装・temp copy で完全リハーサル**。v1 parser defect（`V1_SPECIAL_PAYOUT_FALSE_REFUND`）を v2 再parse で supersession 訂正する。実 sidecar への書き込みは 0（承認未取得）。
- 実装: `src/research-replay/n2SettlementReparse.ts`（pure core, 12 tests）+ `n2SettlementReparseEngine.ts`（DB 実行層 + rollback resolver, 6 integration tests）+ `scripts/reparse-settlement-v2.ts`（`pnpm reparse:n2:settlement`）+ `scripts/rehearse-reparse-rollback.ts`（`pnpm reparse:n2:rollback-rehearsal`）。
- **CLI 安全境界**: source は read-only copy（`--make-copy`）、target は明示 temp copy のみ。source/target 同一・symlink・active WAL を拒否、snapshot SHA-256、chunk/resume、決定的 outputDigest、`--mode=production` は常に BLOCKED。reparse は archive を v2 再parse → hash で sidecar raw_document に照合（backfill gap を自動除外）→ 1回の sequential scan で active map を作り、per-document transaction で append。
- **full temp-copy reparse（digest `247310fb`）**: false_refund_correction **317,747**（Track A reconciler の status_mismatch と完全一致）・special_payout_addition **65,156**・result_kind 0・ambiguous_non_defect 0・unexpected_addition **2（適用せず flag のみ）**。appended candidates 382,903 / supersessions 317,747 / parse_runs 8,167 / observations 58,542。active refunded **319,301 → 1,554**、settled 7,833,297 → 8,216,200、logical active 8,152,599 → 8,217,755、physical 8,156,795 → 8,539,698（append-only）。afterConsistent=true（delta==full-scan 実測）。
- **検証**: full integrity `integrity_check=ok / FK 0 / orphan 0 / ambiguous active 0`、second-run appended 0（idempotent）、append-only UPDATE/DELETE blocked。canary（決定的 cohort 46 files, digest `2902a5a1`）は refactor 後の committed engine で bit 一致再現。
- **rollback rehearsal（`bb95f227`, REHEARSED）**: resolver-only rollback（reparse parse_run を無視）が v1 original（refunded 319,301, settled 7,833,297）を復元、append-only reversal（監査追記・double-rollback idempotent・audit UPDATE/DELETE blocked・physical rows 不変）、backup（VACUUM INTO quick_check=ok）/restore（hash 一致・resolver 一致）。
- **source 非伝播**: `data/research-replay.sqlite` SHA-256=`d9b5ddd2…` 実行前後で不変、mtime Jul 29、-wal 無し。`data/boat.sqlite` は開いていない（mtime 変化は独立 live collector）。
- **承認パッケージ**: `reports/n2/settlement-reparse-approval-manifest.json`（approvalTargetDigest `647993a1`, NOT_APPROVED / real-sidecar apply NOT_EXECUTED / production apply BLOCKED）+ `docs/n2-settlement-reparse-apply-runbook.md`。正本 report: `reports/n2/settlement-reparse-full.json/.md`・`settlement-reparse-canary.*`・`settlement-reparse-rollback-rehearsal.*`。
- 全 583 tests pass、targeted strict typecheck（tsc -b）PASS。

current / blocked:

- **実 sidecar apply は未承認・未実行**。production threshold/approval/live writer/collector/prediction/model/BUY・WATCH・SKIP/app_settings/production DB schema は変更していない。
- unexpected_addition 2 件（v2 非特払い settled で対応 active v1 無し）は適用せず手動レビュー待ち。not_ingested 7 files / 未マッチ raw 3 件は backfill cutoff・source-duplicate 由来で reparse scope 外。
- N2 label truth は実 sidecar への corrected candidate 反映（承認後）まで READY にしない。ただし承認可能な訂正パッケージは完成した。

next（最優先を1つ）:

1. 承認者が `approvalTargetDigest` + snapshot identity に束ねた append-only approval grant を記録したら、production apply gate（backup→canary→apply→verify→rollback rehearsal）を実装して実 sidecar へ適用する。承認前は BLOCKED。

## 2026-08-03 reparse production apply gate + 保留2件確定 + 可視化（実適用は未承認）

completed:

- **unexpected_addition 2 件を read-only 調査で完全特定**: `2014-03-28:08:R1/win`・`2014-03-28:17:R2/win`。両者 v2=win 返還・v1 candidate 無し → 分類 **`CONFIRMED_V1_WIN_REFUND_OMISSION`**（win 返還欠落という別 v1 defect、本 special-payout reparse の scope 外）。auto-apply せず hold。正本 `reports/n2/unexpected-additions-audit.json/.md`。この決定で reparse 訂正 scope は不変（full digest `247310fb` 維持）。
- **classification を versioned contract 化**: `classifyUnexpectedAddition`（enum: CONFIRMED_V1_WIN_REFUND_OMISSION / CONFIRMED_MISSING_SPECIAL_PAYOUT / CONFIRMED_SOURCE_DUPLICATE / MANUAL_REVIEW_REQUIRED …）。auto-apply は特払い defect のみ、それ以外は fail-closed hold。
- **production apply gate 実装**: `src/research-replay/n2SettlementReparseApply.ts`（`resolveReparseApplyGate`）が既存 append-only approval lifecycle（`resolveApproval`）を再利用し、approval target digest / source snapshot SHA・size / schema / mode=production / code SHA / WAL / disk を束ねて解決。`scripts/apply-settlement-reparse.ts`（`pnpm apply:n2:settlement-reparse`）は gate を immutable/read-only で解決し、承認が無ければ exit 3・write 0。承認済みのみ TOCTOU 再確認後に temp-copy と同一 engine コードパスで append-only 適用。
- **実 sidecar に対し gate を実測 → BLOCKED（exit 3）**: blocks=`[MANIFEST_MARKED_NOT_APPROVED, APPROVAL_SCOPE_MISMATCH]`。sidecar の approval grant は F0-R・N1-B のみで、`N2_SETTLEMENT_REPARSE_APPLY` scope の grant は存在しない。source SHA-256 `d9b5ddd2…` 実行前後不変・write 0。正本 `reports/n2/settlement-reparse-apply.json`。
- **approval manifest v2**: 旧 approvalTargetDigest `647993a1…` を superseded とし、新 digest **`7e38b564…`**（source SHA/size/schema/git SHA/archive inventory digest `ee402370…`/parser/canonicalization/contract versions/件数/canary・full・rollback digest/expected before-after/rollback strategy/scope/mode/validity を束ねる）。
- **可視化成果物**: `reports/n2/settlement-reparse-dashboard.html`（self-contained、Before/After・年別/券種別 SVG・実レース12例・進捗）、`settlement-reparse-before-after.md`、`settlement-reparse-examples.json`。false_refund 317,747・special_addition 65,156・真の返還 1,554・eligible率 約96.03%→約99.98%。
- 全 598 tests pass、targeted strict typecheck PASS。

current / blocked:

- **有効な production approval は存在しない → production apply BLOCKED / real-sidecar apply NOT EXECUTED**。Claude は承認を作成しない。
- held-out 2 件（win 返還欠落）は別 defect・別承認の別訂正で扱う（本 reparse では不変更）。
- production threshold/approval/live writer/collector/prediction/model/BUY・WATCH・SKIP/app_settings/boat.sqlite/production DB schema は未変更。

next（最優先を1つ）:

1. 承認者が `rollout_approval_grants_v2` へ scope=`N2_SETTLEMENT_REPARSE_APPLY` / mode=production / target_schema_version=`n1-settlement.0.3@<sourceSha256>` / target_contract_version=`n2-settlement-reparse-apply-v1:7e38b564…` の append-only grant を記録したら、`pnpm apply:n2:settlement-reparse --mode=production` で gate 経由 backup→apply→verify→rollback readiness を実行する（承認前は BLOCKED）。

## 2026-08-03 承認 gate を settlement-content identity へ束縛し直し + 人間承認 artifact 完成

completed:

- **設計defect修正（重要）**: production apply gate は whole-file SHA-256/size を snapshot 束縛にしていたが、承認 grant を同一 sidecar へ append すると SHA が変化する（synthetic sidecar で実証: 46eaf337→7ec6861b）ため、承認後に gate が `SOURCE_SNAPSHOT_SHA_MISMATCH` で誤 BLOCK し apply 不能だった。`computeSettlementSnapshotIdentity`（settlement テーブル DDL＋status×revision×superseded 分布＋line/candidate/source_dup 件数）へ束縛を移し、approval/audit append で不変にした。whole-file SHA/size は advisory record のみ。gate test 14/14。commit `fa3223b`。
- **approval manifest v3**: approvalTargetDigest **`6e2eb2ab…`**（settlement snapshot identity `a7d68acb…` を束ねる）。旧 v1 `647993a1…`・v2 `7e38b564…` を supersede（理由: whole-file SHA 束縛は in-DB approval で apply 不能）。archive inventory `ee402370…`、apply code SHA `fa3223b`。
- **人間承認 artifact 完成（Claude は grant を作成・記録・実行しない）**: `reports/n2/settlement-reparse-approval-grant.json`（approver identity/approved-at は placeholder）、apply-intent manifest `reports/n2/settlement-reparse-apply-manifest.json`（digest 不変）、JSON Schema `config/n2-settlement-reparse-approval-grant.schema.json`（validation PASS）、operator runbook `docs/n2-settlement-reparse-approval-operator-runbook.md`（record/apply/verify/revoke command + pre/post checklist）。
- **実 sidecar 相手に apply gate 実測 → BLOCKED（exit 3, write 0）**: blocks=[MANIFEST_MARKED_NOT_APPROVED, APPROVAL_SCOPE_MISMATCH]。settlement identity と code SHA は一致（誤 BLOCK なし）。有効な reparse-apply 承認は存在しない。
- 可視化 dashboard に Approval readiness（v3 digest / settlement identity / approval present NO / apply executed NO / rollback readiness / next human action）を追加。全 598 tests pass。

current / blocked:

- **有効な production approval は存在しない → production apply BLOCKED / real-sidecar apply NOT EXECUTED**。Claude は自己承認しない。
- 実 sidecar・boat.sqlite・app_settings・collector・prediction・model・BUY条件・production threshold・live writer は未変更。source settlement data 不変（settlement identity `a7d68acb…`）。

next（最優先を1つ）:

1. operator が `docs/n2-settlement-reparse-approval-operator-runbook.md` の Step 1 で `N2_SETTLEMENT_REPARSE_APPLY` 承認 grant（target_contract_version=`…:6e2eb2ab…`）を append したら、`pnpm apply:n2:settlement-reparse --mode=production` で gate 経由 apply を実行する。承認前は BLOCKED。

## 2026-08-03 owner 承認による production apply 完了 + dispatch 基盤構築

### settlement 訂正（完了）

- owner `m-shogo` の明示承認（reference `owner-explicit-approval-2026-08-03`）を **operator として** append-only 台帳へ記録した（Claude の自己承認ではない）。grant ID `n2-settlement-reparse-apply-d9b5ddd2-6e2eb2ab`、mode=production、approvedAt=2026-08-03T13:01:48.000Z。
- 記録前に固定値を全一致確認: approval target digest `6e2eb2ab…`、settlement snapshot identity `a7d68acb…`、schema `n1-settlement.0.3`、archive inventory `ee402370…`、apply code `fa3223b`、before counts。
- **grant 追記で whole-file SHA は変化（`d9b5ddd2…`→`d5eef1fe…`）したが settlement-content identity は不変**（`a7d68acb…`）。v3 の identity 束縛設計が実運用で正しいと実証された（v2 の whole-file SHA 束縛なら誤 BLOCK していた）。
- 事前に atomic backup（`VACUUM INTO`、8.7GB、SHA `a2e33a72…`、quick_check ok、gitignored）を取得。
- **production apply 実行: `APPLIED` / exit 0 / `APPROVAL_VALID`**（55.4 分、files ingested 8,167、parse errors 0）。
  - false_refund_correction **317,747**、special_payout_addition **65,156**、held-out **2（未適用）**、ambiguous 0、result_kind 0
  - active: settled 7,833,297 → **8,216,200** / refunded 319,301 → **1,554** / partially_refunded 1
  - physical rows 8,156,795 → **8,539,698**（append-only、既存 row の UPDATE/DELETE なし）
  - integrity_check **ok** / FK 0 / orphan 0 / cycle 0 / dangling 0 / ambiguous active 0
  - 実 DB を独立 SQL でも確認し、期待値と完全一致。WAL は checkpoint 済み（quiescent）。
- **corrected truth freeze**: `reports/n2/corrected-settlement-truth-freeze.json`。correctedTruthVersion `n2-corrected-settlement-truth-v1`、適用後 settlement identity **`35356298…`**、whole-file SHA `b6184156…`。observed_as_of と corrected_truth_as_of の使い分け契約、backup/rollback 参照を記録。
- held-out 2 件（`CONFIRMED_V1_WIN_REFUND_OMISSION`: 2014-03-28 常滑R1/win・宮島R2/win）は **適用していない**。別 defect・別承認で扱う。

### dispatch 基盤（完成・毎時ループなし）

- **self-hosted runner 登録済み**: `boat-pon-mac-local`、labels `self-hosted, macOS, ARM64, boat-pon-local`、status **online**、launchd service 起動。job 待機のみで研究処理を自発実行しない。credential/token は Git 非保存（`~/actions-runner-boat-pon`）。
- **workflow** `.github/workflows/boat-pon-local-research.yml`: `workflow_dispatch` のみ（**`on.schedule` なし**）。ubuntu guard job が repo/actor/ref/event/safety level を検証してから self-hosted job へ渡す。GitHub expression は env 経由のみ。concurrency（cancel-in-progress false）、main 固定 checkout、request 検証、1 task 実行、allowlist commit。
- **one-shot orchestrator**: `src/automation/researchOrchestrator.ts` + `scripts/run-research-task.ts`（`automation:task/status/validate-request/pause/resume/emergency-stop`）。lock（atomic・stale 検出）、preflight guard、safety level L0–L2 許可 / L3 は既存 grant 必須 / **L4 常時拒否**、failure 分類、path allowlist。ループ・daemon・watch なし。
- **registries**: task queue（READY 3件）、edge / experiment / rejection / holdout registry、request dirs（pending/claimed/completed/failed）。
- **有限回テスト（実測）**: strict request validation PASS / 改変 request は digest mismatch で拒否 / **L4 request は `REJECTED_L4` exit 3** / dirty tree・git drift・active WAL・emergency stop・pause がすべて BLOCK / clean tree で `DRY_RUN_OK`。
- **end-to-end 実行**: `gh workflow run` → guard PASS → self-hosted runner → `DRY_RUN_OK` → `automation/boat-pon-research` へ push（run `30821403218` success）。実行後 runner は idle、**自動再 dispatch なし（run は 1 件のみ）**。
- **ChatGPT bridge**: `docs/chatgpt-scheduled-task-bridge.md`（Scheduled Task へ貼る prompt、dispatch 経路チェックリスト、結果確認経路、L3/L4 境界、NO_CHANGE 条件）。
- dashboard: `reports/automation/research-dashboard.html`（runner/GitHub/data/N2/research/latest run）。値が無い項目は 0 を捏造せず NOT_STARTED / NOT_AVAILABLE 表示。

### 未変更（確認済み）

`data/boat.sqlite`・app_settings・collector（既存 launchd は Jul 18 のまま）・production prediction・model・BUY/WATCH/SKIP・production threshold・live writer・operational GC・自動投票/購入。新規 launchd は runner service のみ。GitHub schedule / cron は無い。

next（最優先を1つ）:

1. ChatGPT 側で `docs/chatgpt-scheduled-task-bridge.md` の prompt を Scheduled Task（毎時）へ登録し、`workflow_dispatch` 経路で 1 回ずつ task を依頼する。

## 2026-08-04 ChatGPT request-file dispatch + 実 executor 接続（毎時 schedule 未登録）

completed:

- **実 task executor を接続**（`src/automation/taskExecutors.ts`）。allowlist registry で taskType→executor を静的解決し、未登録は `EXECUTOR_NOT_REGISTERED` で BLOCK（queue は READY 維持、NO_CHANGE を成功扱いにしない）。prototype pollution 経由の解決も拒否。全 executor は read-only（`policy.dataRoot` から immutable open、active WAL 拒否、実 sidecar write 0）。
- **TASK-N2-001 dataset-canary（L2）実測 PASS**: 固定月 cohort 2024-06、races **4,662** / candidates **32,626** / eligible **32,622（99.99%）** / excluded 4（genuine refund）/ source duplicate 0 / superseded 21 / held-out 除外規則あり。PIT PASS・leakage PASS。digest `5799f38c…`（local と runner で一致＝決定的）。出力 `reports/n2/n2-dataset-canary.json/.md`。
- **TASK-N2-002 readonly-analysis（L0）実測 PASS**: corrected eligible 率 **99.98%**（active 8,217,755 / settled 8,216,200 / refunded 1,554）、legacy 96.03% から **+3.95pt**。年代別も 2000〜2026 で 99.98〜99.99% と安定。`forwardResultClaim: false`（historical 集計であり forward 結果ではない）。出力 `reports/n2/n2-corrected-eligibility.json`。
- **TASK-N2-003 readonly-audit（L0）実測 PASS**: held-out 2 件の lineage、defect mechanism（v1 は win 返還 candidate 自体を生成しない＝特払い bug とは別機序）、影響範囲 scan **26,089 races**（上限候補）、`proposedDefectCode: V1_WIN_REFUND_OMISSION`、auto-correction 不可・別承認必要・**production apply 未実行**。出力 `reports/n2/n2-win-refund-omission-audit.json`。
- **queue state machine を実結果へ接続**: `READY→CLAIMED→RUNNING→PASS/CONDITIONAL/BLOCKED/FAILED_*` を `canTransition` 検証付き atomic 更新。attemptCount・evidenceLinks・runId・requestId・executorVersion・resultDigest・nextDecision を記録。依存未達は CLAIM しない（N2-002 は N2-001 が PASS でなければ BLOCK、実測で確認）。
- **ChatGPT 用 request-file dispatch を実装**（`.github/workflows/boat-pon-request-file-dispatch.yml`）。`push` / `main` / `automation/requests/pending/*.json` のみ、**`on.schedule` なし**。guard（ubuntu）が repo/actor/branch/event、**1 push 1 request**、modified/deleted 拒否、path traversal・symlink・非 .json・サイズ、strict schema、filename↔requestId、`requestDigest`/`queueDigest`/`authoritySha`、replay registry、CLAIMED/RUNNING 重複、L4 拒否・L3 grant 必須を検証。runner 側でも path を再検証。
- **request builder**: `pnpm automation:build-request`（canonicalization は既存式を再利用）+ `automation/request-template.json`。
- **有限回 E2E（実測）**: request file commit → guard PASS → self-hosted runner → 1 task 実行 → `automation/boat-pon-research` へ結果 commit → runner idle。TASK-N2-001（run 30878214593, PASS, digest 5799f38c…）、TASK-N2-002（run 30878413662, PASS）、TASK-N2-003（run 30878594429, PASS）、最終 clean run（run 30878719144, **success**）。**自動再 dispatch なし**（run は依頼ごとに 1 件）。
- guard 実証: stale authoritySha 拒否、DIRTY_WORKING_TREE、GIT_DRIFT、dependency 未達 BLOCK、L4 `REJECTED_L4` exit 3、tamper 時 digest mismatch、emergency stop / pause。
- 全 **619 tests pass**（automation 21 tests を CI の test glob へ追加）、typecheck・CI green。

current / blocked:

- 毎時 schedule は**未登録**（ChatGPT 側で登録する）。repo に schedule/cron/launchd hourly/daemon は無い。
- held-out 2 件は未適用のまま（別 defect・別承認）。実 sidecar・boat.sqlite・app_settings・collector・prediction・model・BUY 条件・production threshold・live writer は未変更。

next（最優先を1つ）:

1. ChatGPT の Scheduled Task に `docs/chatgpt-scheduled-task-bridge.md` の最終 prompt を毎時で登録する（第一経路 = request file commit）。
