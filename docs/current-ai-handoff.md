# boat-pon AI作業引継ぎ（正本）

更新: 2026-08-01

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
