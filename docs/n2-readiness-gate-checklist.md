# N2 Readiness Gate Checklist（着手前・設計のみ）

更新: 2026-08-03
状態: **N2 contract hardening中（archive↔canonical reconciliation完了、label truthは実sidecar corrected reparse待ち、model/training未着手）**

N1-C（全券種 settlement canonical 基盤）完成を受け、N2（市場残差/選手能力等を用いた予測・評価フェーズ）へ進む前に満たすべき gate を、repo・docs・schema・reports から整理する。本書は checklist であり、N2 実装・training・BUY/WATCH/SKIP・threshold 変更・production 接続は一切行わない。

## N1 が N2 へ提供するもの（READY）

| 項目 | 状態 | 根拠 |
|---|---|---|
| settlement truth（全7券種、payout/refund/status） | STRUCTURE READY / SEMANTICS AUDIT PENDING | integrity/FKは通過。parser v1特払い誤分類のraw全件再集計は未完了 |
| canonical active view（重複排除済み） | READY | active canonical race-level uniqueness=0、source_duplicate resolution |
| raw provenance / evidence lineage | READY | capture→raw→parse→observation→candidate、append-only、raw immutable |
| post-race leakage boundary | READY | observation type=post_race（leakage sentinel test） |
| revision/refund/cancellation/conflict の表現 | READY | status axis（settled/refunded/partially_refunded/cancelled/no_sale/pending）、conflict group、revision kind |
| reproducibility（決定的再構築） | READY | source archive immutable＋deterministic backfill/resolution |
| value 整合（legacy 照合） | READY | payout mismatch 0（sample 2,000） |

## N2 readiness gate（2026-07-30 audit、A–N）

design/contract/enforcement/prototype を実装（[`n2-data-contracts.md`](n2-data-contracts.md) / [`n2-feature-pit-contract.md`](n2-feature-pit-contract.md) / [`n2-evaluation-and-split.md`](n2-evaluation-and-split.md) / `src/research-replay/n2DatasetContract.ts` + tests / `reports/n2/n2-dataset-profile.json`）。

| gate | 状態 | 根拠 |
|---|---|---|
| A. canonical settlement truth | **CONDITIONAL** | structural integrity/active uniquenessはPASS。archive↔canonical reconciliation完了（canonical_only=0, false_refund 317,747確定）。corrected `parser_reparse`/supersession を temp copy で完全リハーサル済み（integrity ok, idempotent, rollback可, digest 247310fb）で承認可能パッケージ化。実sidecar適用は `approvalTargetDigest` 束ねた承認 + apply gate で未実施 |
| B. training dataset contract | **READY(scaffold+verified-lineage contract) / PROFILE STALE** | selection builder + F0 observation/parse/raw read-only JOIN検証 + source adapterを実装。unsafe/未検証lineageはcandidate全体0行。実DB join未実行。96.03%はparser v1誤分類（317,747偽返還）を含み、reconciliationで v2 corrected eligible ≈99.98% と確定したが、実sidecar corrected candidateへ置換するまでtraining truthにしない |
| C. target definition | **READY(enforcement)** | target v2、7券種212 selection列挙、`hit/loss/refund/special_payout/void`、12 contract tests PASS |
| D. feature PIT | **READY(enforcement+complete temp capture lineage+retry dedup+immutable coverage reader) / BLOCKED(real observations)** | strict `official_program` parserとprimary照合に加え、tempでcapture attempt/events→byte-exact raw/link→parse/domain/typed payloadを接続。event時刻逆行・byte count不一致・誤linkを拒否し、parse errorをcapture failureと分離。同一raw retryは2 capture/link・1 raw・1 parse/observationを保証し、別race identityは再利用しない。capture失敗はterminal attemptとして隔離し、同じlogical groupの新attemptだけがretry成功できる。collector E2E 6/6、今回の関連tests 12/12 PASS。F0-R既存gateでprimary非伝播・outbox retry・rollback/kill switchも確認済み。実collector sidecar writeと実profileはPENDING |
| E. odds PIT/timing | **READY(enforcement+lineage+immutable trifecta coverage reader) / BLOCKED(all-bet observations)** | F0 typed `trifecta_market`をcheckpoint別120selectionへ展開し、payload schema/hash・observed_at・lineage・selection spaceを検証。bet_type不明legacy rowは昇格禁止。E2E 4/4 PASS。全7券種live observationは未整備 |
| F. unresolved settlement handling | **CONDITIONAL** | conflict/cancel/source_duplicateはfail-closed。部分返還labelは修正済み。archive明示返還のraw監査完了（真の返還≈1,554、v1偽返還317,747と分離確定）。実sidecarへの反映は別承認 |
| G. dataset reproducibility | **READY(code) / PENDING(real data run)** | immutable DBをclose後、別connectionで入力を再読込する独立rebuild script実装。隔離SQLite fixtureでPASS、実sidecar実行は未確認 |
| H. split policy | **READY(設計)** | time-based・race-level group・coverage gap/era drift 尊重 |
| I. leakage validator | **READY** | `n2DatasetContract.test.ts` + 既存 `check:point-in-time-safety` |
| J. evaluation contract | **READY(設計)** | predictive/financial 分離・bootstrap・CLAUDE.md ROI 基準 |
| K. market baseline | **READY(設計)** | market-implied / frequency / 既存 policy / trivial |
| L. calibration | **READY(設計)** | 券種別 bucket + 信頼区間 |
| M. drift analysis | **CONDITIONAL** | 2001–2003 gapは確定。87%→99.9% eligible driftは、reconciliationで false_refund の年代分布（2005–06 約42–43K/年 → 2020年代 約100–450/年）がほぼ全量の要因と確定。実返還率driftではない |
| N. multiple-bet-type policy | **READY(設計)** | 券種別 model 基本 |

overall: **N2_FEATURE_BUILDER_SCAFFOLD_READY = YES / N2_LABEL_TRUTH_READY = NO**。旧 `N2_IMPLEMENTATION_READY=YES` は実装着手準備だけを意味し、dataset完成・学習開始可を意味しない。

## Archive refund label truth（2026-08-03 確定）

- `pnpm audit:n2:archive-refund-semantics`（v1/v2 full scan）と `pnpm reconcile:n2:archive-canonical`（archive↔canonical reconciliation）を実 K archive（8,174 files）へ read-only 適用し完了。
- canonical refunded ≈319,301 のうち **317,747 が v1 特払いbug由来の偽返還**、真の返還は約 1,554。v2 corrected eligible ≈ **99.98%**（旧 profile 96.03% は v1 誤分類込み）。canonical_only=0（backfill coverage 100%）。
- 正本: `reports/n2/archive-canonical-reconcile.json/.md`、`reports/n2/archive-refund-semantics-audit.md`。
- reparse 実装完了（2026-08-03）: temp copy で false_refund 317,747 + special_addition 65,156 を append-only supersession 訂正し、integrity ok / idempotent / rollback可 / source write 0 を実測。承認パッケージ `reports/n2/settlement-reparse-approval-manifest.json`（approvalTargetDigest `647993a1`）+ runbook `docs/n2-settlement-reparse-apply-runbook.md`。
- production apply gate 実装完了（2026-08-03、`apply:n2:settlement-reparse`）。実 sidecar 相手に gate を実測し **BLOCKED（exit 3, write 0）**（有効な reparse-apply 承認が無い）。保留 unexpected_addition 2 件は `CONFIRMED_V1_WIN_REFUND_OMISSION`（別 defect・scope 外）で hold。approval manifest v2（approvalTargetDigest `7e38b564…`, 旧 `647993a1…` supersede）。可視化 `reports/n2/settlement-reparse-dashboard.html`。
- 残: 有効な production approval が無いため実 sidecar 未適用。適用まで N2 label truth は READY にしない（N2_DATASET_BLOCKED）。

## 実 feature 接続までの残タスク

1. `profile:n2:feature-coverage -- --primary=<db> --sidecar=<db> --from=<date> --to=<date>`を実DBへ適用し、実join率・不一致理由をfeature/年代別に確定する（immutable reader/core/CLI/E2Eは実装済み、実入力待ち）。
   同じ実DBで`--source=trifecta-market --checkpoint=T-5`を実行し、F0 3連単市場の年代/selection別coverageも確定する。legacy bet_typeなしoddsは分母へ混入させない。
2. 実 feature の available_at 付与（historical_safe=source availability必須、race日/imported_at代用禁止、odds=capture時刻を保守的境界、集計=集計 cutoff）。
3. feature store 容量見積り。
4. 実sidecarでselection profile独立rebuildを実行し、archive/canonical label truth訂正後に再生成する。
5. 上記を通過後、offline training gateへ進む。

## 禁止（本フェーズ）

label truth gate通過前のmodel training/tuning、BUY/WATCH/SKIP logic変更、production接続、automatic bettingは禁止。offline code/test/read-only dataset・評価基盤は安全境界内で段階実装する。

### official_program shadow outbox（temp evidence）

- [x] 既存F0-R outboxを再利用し、新しい並行queueを作らない
- [x] default OFFではprimary成功・outbox 0件
- [x] raw本文をoutboxへ複製せずprimary record ID＋期待SHA-256を保存
- [x] URL secret除去、header allowlist、strict payload decoder
- [x] 同一attemptはidempotent、別retry attemptは別message
- [x] primary raw hash不一致はcapture row作成前にfail-closed
- [x] succeeded messageは再配送しない
- [x] backpressure時もprimary collector成功を維持
- [ ] live collector接続、実sidecar shadow canary、承認済みrollback rehearsal（BLOCKED / writer OFF）

### Mixed outbox routing / rollback（temp evidence）

- [x] message typeごとの明示router、duplicate handler登録拒否
- [x] official_programと別messageの混在queueを各handlerへ一度だけ配送
- [x] 未知typeは初回でpermanent failure、retry枠を消費しない
- [x] malformed official_program payloadはcapture evidence作成前にpermanent failure
- [x] 一時handler障害はbackoff後に再試行し成功可能
- [x] rollback後はqueued messageを保持したままdelivery 0件
- [ ] 実sidecarでのmixed canary、kill-switch/restore rehearsal（BLOCKED / live writer OFF）

### Shadow delivery single-writer claim（temp evidence）

- [x] 二つの独立SQLite接続が同一messageを同時候補化するfixture
- [x] consumer A handler中のconsumer B drainはdelivery 0、failure attempt 0
- [x] A成功後のB再drainもdelivery 0
- [x] 同一messageのdelivery attemptは1件
- [x] handler一時失敗でも競合consumerは実行せずretry attempt 1件
- [x] typed observation内部writeをsavepoint化し、外側／内側transaction双方を検証
- [x] `drainWithDiagnostics`でexamined 1 / contended 1を返し、queue空とwrite-lock競合を区別
- [x] subprocess `process.exit(77)`で未commit handler side effect / delivery attempt 0、再open後queued 1→success 1
- [ ] 実sidecarの複数process canaryと承認済みcrash kill rehearsal（BLOCKED / live writer OFF）

### Shadow handler atomicity / deadline（temp evidence）

- [x] handler部分DB write後の例外をsavepoint rollbackし、side effect 0 / retry attempt 1
- [x] monotonic wall-time budgetと協調`throwIfCancelled`
- [x] deadline超過を`SHADOW_HANDLER_DEADLINE_EXCEEDED`としてretry分類
- [x] deadline超過前のhandler DB side effectをrollback
- [x] drain counter整合性を検証し、不整合snapshotをfail-closed
- [x] health snapshotへcounter/healthのみ保存し、message payloadを含めない
- [ ] external side effect handlerは未許可。別の冪等/reconciliation契約なしでは接続禁止
- [ ] 実sidecar canaryと承認済みwall-time/kill rehearsal（BLOCKED / live writer OFF）


### Shadow operability report / threshold gate（temp evidence）

- [x] retry exhaustionを固定`SHADOW_RETRY_EXHAUSTED`で明示的permanent failureから分離
- [x] queued / ready / oldest age / retrying / permanent / exhaustedをread-only集計
- [x] versioned caller-supplied threshold（production値の暗黙defaultなし）
- [x] recent drain contention / deadline counter集約とdiagnostics shape整合性検証
- [x] PASS / WARN / BLOCKEDの明示理由、入力同一時の決定的digest
- [x] reportへmessage payloadを含めず、read中のDB change 0
- [x] malformed historical diagnosticsをfail-closed
- [ ] 実sidecar policy approval、immutable CLI、shadow canary（BLOCKED / live writer OFF）


### Shadow operability policy / immutable CLI（temp evidence）

- [x] strict policy decoder＋JSON Schema、unknown field/default drift拒否
- [x] policy canonical digestをappend-only approval targetへ結合
- [x] missing / target mismatch / revoked / superseded approvalをBLOCKED
- [x] simulated approvalをproduction modeで拒否
- [x] immutable/read-only/query-only CLI、明示`as-of`必須
- [x] active WAL拒否、quiescent snapshot限定
- [x] PASS 0 / WARN 2 / BLOCKED 3のmachine-readable exit contract
- [ ] production threshold approval、snapshot identity binding、実sidecar canary（BLOCKED / live writer OFF）
