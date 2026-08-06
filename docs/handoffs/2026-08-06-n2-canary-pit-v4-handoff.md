# Boat Pon N2 production canary / PIT v4 引き継ぎ

更新: 2026-08-06 15:00 JST

## 正本と現在地

- repository: `m-shogo/boat-pon`
- main HEAD: `e1f932b3f0288755ed18849ab369e86d258a329d`
- automation authority branch: `automation/boat-pon-research`
- Current BUY、selector/model、LINE、`app_settings`、primary DB schema、holdout、Cloudflare、広告、投票処理は変更していない。
- global shadow writeはOFF、自動投票は未実装・未許可のまま。

## 今回完了したこと

### 1. official_program production canary

最新primary sourceから生成した20件のreview bundleを固定した。

- bundle version: `n2-official-program-canary-review-bundle-v2`
- generatedAt: `2026-08-06T01:38:20.672Z`
- manifest digest: `151c34786e29ca80838da0fe3b2eb3326ee343d0a3656e8f20666af14d1b3a85`
- source rows: 1,001
- eligible rows: 999
- excluded: 2
- selected races: 20
- TASK-N2-013: `PASS`, attempt `3/3`。再実行禁止。

production canaryの実適用結果:

- first apply: 20 insert / 0 reuse
- idempotent replay: 0 insert / 20 reuse
- official_program observations: 20
- trifecta_market observations: 0
- capture attempts: 20
- primary write count: 0
- sidecar quick_check: `ok`
- exact approval: 1回作成後、即時revoke
- current approval resolution: `APPROVAL_REVOKED`
- global shadow write: OFF

適用workflowの最終レポートは、書き込み・replay・revoke完了後のprimary再照合時に別プロセスのWALを検知し、`VERIFY_PRIMARY_SELECTED_ROWS_UNCHANGED / PRIMARY_DB_ACTIVE_WAL`で`FAILED`表記になった。canaryを再実行せず、後続のread-only事後検証を実施した。

事後検証結果:

- status: `PASS`
- selected 20件が一意に存在
- parse/raw lineage join: 20/20
- official_program: 20
- trifecta_market: 0
- primary WAL: 0 bytes
- primary selected rows: 20/20 hash一致
- approval grant/revoke存在、現在無効
- verification write count: 0
- semantics: `20_INSERTED_20_REUSED_APPROVAL_REVOKED`

証拠:

- `reports/n2/n2-official-program-canary-review-bundle.json`
- `reports/n2/n2-official-program-canary-apply.json`
- `reports/n2/n2-official-program-canary-verification.json`

### 2. PIT reader v2

PR #64をmerge済み。

production `official_programs`の実race IDが会場名形式である一方、旧readerは会場code形式のみを想定していた問題を修正した。

reader v2は次の2形式だけを厳格に許可する。

- `YYYYMMDD-会場名-RR`
- `YYYYMMDD-会場コード-RR`

照合条件:

- exact date
- exact race number
- `officialVenueCode(venue)`一致
- 許可されたexact race ID
- matching rowが一意
- `close_at`がJSTの正しい時刻

欠損、別race、未知会場、重複identity、不正時刻は従来どおり`decisionCutoff=null`でfail-closed。

実production 20件のread-only検証:

- returned observations: 20
- cutoff resolved: 20
- status: `PASS`
- verified safe: 20
- ambiguous: 0
- same-race leakage: 0
- future leakage: 0
- checked odds: 0

### 3. N2-011 PIT contract v4

PR #65をmerge済み。main HEADは本書冒頭のSHA。

- catalog: `2026-08-06-n2-governance-v8`
- TASK-N2-011 definition: v4
- PIT reader: `n2-pit-audit-reader-v2`
- PIT executor: `n2-pit-audit-executor-v3`
- verified 20-race official-program canaryを入力契約へ追加
- live trifecta-market observationが0件であることを、checked odds 0として明示

検証済み:

- TypeScript typecheck: PASS
- targeted N2 PIT tests: PASS
- production 20 observations read-only validation: PASS
- research governance: PASS
- full repository tests: 829 total、825 pass、2 skip、fail 0（最終再実行）
- Research Replay golden/readiness: PASS
- product/public one-way boundary: PASS
- BUY/LINE boundary: PASS
- production build: PASS

## automation正本の未同期状態

mainはcatalog v8 / N2-011 definition v4だが、automation branchのqueue正本はまだ旧状態。

`automation/control/task-queue-state.json`:

- catalogVersion: `2026-08-06-n2-governance-v7`
- stateVersion: 46
- TASK-N2-011: `CONDITIONAL`
- taskDefinitionVersion: 3
- attemptCount: 2 / maxAttempts: 3
- 過去evidenceは3件保持

`automation/control/current-run.json`:

- stateVersion: 47
- lastResult: PASS
- lastTaskId: TASK-N2-013

queue fileとcurrent-runでstateVersionが46/47にずれている。単純上書き禁止。開始時にblob SHA、processed intents、processed requests、supersessions、current-run、queue validatorを再読込し、CAS付きmigrationで整合させること。

## 次に行う作業 — 厳密順序

### Phase A: N2-011最終監査を安全に実行

1. main HEAD、automation branch HEAD、queue/current-run/processed ledger/supersessionsを再取得する。
2. primary/sidecarのactive WAL、dirty worktree、disk、kill switch、shadow OFFをintent作成前に確認する。
3. automation queueをcatalog v8へCAS migrationする。
   - TASK-N2-011だけdefinition v4へ更新
   - statusをREADYへ戻す
   - attemptCountは2のまま
   - maxAttemptsは3のまま
   - 既存evidence linksを全保持
   - authoritySha/resultDigest/lastFailure/checkpointは新実行用にclear
   - queue/current-runのversion不整合をvalidatorに従って解消
4. immutable intentを1件だけ作る。既存の未処理同等intentがあれば新規作成しない。
5. canonical guardを通し、Mac self-hosted runnerでTASK-N2-011を1回だけ実行する。
6. 期待値:
   - result PASS
   - REAL_DATA
   - audited 20
   - verifiedSafe 20
   - checkedFeature 20
   - checkedOdds 0
   - same-race 0
   - future 0
   - ambiguous 0
   - primary/sidecar write 0
7. WAL、authority drift、manifest mismatch等があればfail-closed。最終attemptを無計画に再試行しない。

### Phase B: trifecta_market観測を先に作る

N2-020 market-only baselineはtrifecta_market observationが0件のままでは意味のある評価ができない。catalog dependencyだけを見て先にPASSさせない。

新しい正式taskを追加するか、既存readiness契約を拡張して、次を別承認・別canaryで実施する。

1. live trifecta-market source inventory/readiness
2. read-only review bundle
3. 最大20 race/checkpointのbounded canary
4. exact digest approval
5. apply + idempotent replay
6. 即時revoke
7. raw/parse/typed payload/PIT/primary identityのread-only事後検証
8. global shadow writeはOFFのまま

公式番組canaryのapprovalやmanifestを市場観測へ流用しない。

### Phase C: baseline層

実装は安全に並列化可能だが、実行順はデータ依存を守る。

- TASK-N2-021 historical-only baseline executor
  - N2-011 PASS後に実装・実行可能
  - pre-row training boundary、immutable snapshot digest、holdout除外を必須化
- TASK-N2-020 market-only baseline executor
  - trifecta_market verified observationsが揃ってから実行
  - reciprocal odds、overround正規化、PIT checkpointを固定
- TASK-N2-022 common cohort comparison
  - market / historical / legacyをexact same identitiesで比較
  - overlap不足、label/cutoff conflictは順位付けせずfail-closed

### Phase D: 評価とEdge探索

- TASK-N2-030: logloss / Brier / calibration / coverage / ROI / drawdown
- TASK-N2-040: player/course/ST/exhibition/motor/weather等の仮説scan
- TASK-N2-041: historical test。forward昇格は禁止
- TASK-N2-042: confounder / rejection audit、rejection registry更新

Edge探索では高ROIだけで採用しない。sample size、最大払戻除外、期間drift、venue/month偏り、multiple testing、PIT、common cohortを必須にする。

## Public dashboard別レーン

現在のopen PRは #35 `feat(public): add deploy-ready dashboard preview artifact`。

- public snapshot transport、standalone shell、last-known-good publication基盤の後続
- static preview artifactのみ
- Cloudflare deploy、credential、広告networkは未接続
- Current BUY/LINE/DB/automationとは分離

研究laneとコード競合しにくいため並行可能だが、最新mainへrebase/mergeし、CI全PASS後のみmergeする。公開画面へexact BUY、stake、live odds、private owner dataを出さない。

## 絶対禁止

- Current BUYやselector/model parameterを研究結果だけで変更しない
- LINE通知内容・送信状態を変更しない
- `app_settings`を変更しない
- primary operational DBへ書かない
- holdoutを覗かない、再定義しない
- approvalを使い回さない
- global shadow writeを自動ONにしない
- public requestからMac/sidecarへ到達させない
- automated bettingを実装・有効化しない
- 実行証拠なしにPASS、完了、production-readyと書かない

## 次チャットの開始時に報告する形式

- 作業レーン
- 実行場所: このチャット / GitHub / Mac self-hosted / 毎時スケジュール
- 読み取ったmain SHAとautomation branch SHA
- queue/current-run/processed ledgerの差分
- 今回触るtaskと触らない領域
- 実行後のcommit/PR/run ID/evidence path
