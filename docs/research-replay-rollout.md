# Stage F0-R Research Replay Foundation Rollout

最終更新: 2026-07-24

## 結論

Stage F0-Rは`COMPLETE`である。F0の五層evidence schemaを変更せず、expand-onlyな`f0r.2.0`を独立sidecar `data/research-replay.sqlite`へ適用した。2026-07-24に承認gateを`f0r-approval-v2`へhardeningし、readiness自身が承認を生成できない構造へ修正した。`data/boat.sqlite`はread-only fingerprint監査だけに使用し、schema、`app_settings`、Legacy collector、BUY/WATCH/SKIP、通知、評価系列へ接続していない。

実測正本:

- [`../reports/research-replay-rollout-readiness.md`](../reports/research-replay-rollout-readiness.md)
- [`../reports/research-replay-rollout-readiness.json`](../reports/research-replay-rollout-readiness.json)

## Rollout境界

- Research sidecar: `data/research-replay.sqlite`
- Raw root: `data/research-replay-raw/`
- Backup: `backups/research-replay/`
- Schema: `f0r.2.0`
- Shadow writer: default `OFF`
- Operational GC: default `OFF`
- Live collector接続: なし
- Production decision/通知/購入接続: なし
- Phase N1-B: `n1-settlement.0.1`を永続sidecarへzero-dataで適用済み（N1-C backfillは未実行）

sidecar、raw、backupはGit管理外である。sidecarに保存したのはschema ledger、F0-R開始承認、default-OFF config、backup/restore/health auditだけで、公式データ収集やdecisionは行っていない。

## Human approval gate v2

承認記録とreadinessを分離した。`research:approval:record`だけがgrant/revoke/supersedeをappendでき、`research:rollout:readiness`はscope、source、reference、target stage/schema/contract、approved_at、mode、content hash、lifecycleを検証するだけで承認rowを作らない。

- contract: `f0r-approval-v2`
- resolver: `f0r-approval-resolver-v1`
- grant / lifecycle: append-only
- production実行: simulated approvalを拒否
- 承認なし: `BLOCKED / HUMAN_APPROVAL_MISSING`
- target不一致、rollout後承認、revoked、superseded、hash不一致: default-deny
- 旧`f0r-start-approval-v1`: target contractやreferenceを検証できないためv2承認として数えない

旧イベントは削除・更新しない。新しい明示grantと、旧イベントを不適格とする訂正lifecycleを追記し、過去の誤った承認扱いを隠さない。

## Expand-only compatibility

F0-R migrationは既存F0 evidence tableを変更・削除せず、次を追加する。

- `rollout_schema_contract`
- `rollout_approval_events`
- `rollout_config_events`
- `shadow_outbox_messages`
- `shadow_delivery_attempts`
- `operational_audit_events`

minimum reader/writerはF0 contractを維持する。migration ledgerは`partial`を検出し、checksum一致時だけ再開する。checksum不一致、未知schema、partialのままのschemaはdefault-denyとする。

## Shadow failure isolation

primary処理を先に完了し、optional shadowは別処理として実行する。shadow失敗をprimaryへthrowしない。

Outboxは次を満たす。

- idempotency key
- bounded queue
- retry上限と指数backoff
- append-only delivery attempt
- backpressure
- storage quota
- disk low-water mark
- kill switch
- secret-like payload key拒否

現在はlive collectorへ接続しておらず、実sidecarのshadow writerは`OFF`である。Failure isolationとoutbox replayはrestore copy上のsanitized canaryだけで検証した。

### Handler atomicity / bounded runtime

- delivery handlerを専用SQLite savepointで囲み、handler例外またはdeadline超過では同一接続上の部分書込みをrollbackしてからfailure attemptをappendする。
- 既定wall-time budgetは30秒。1ms〜300秒の範囲でrun単位に指定し、monotonic clockで判定する。
- handler contextの`throwIfCancelled`による協調停止と、return直後の強制deadline確認を行う。同期handler自体を外部からpreemptできるとは主張しない。
- DB外部副作用はrollback対象外のため、このhandler境界では禁止する。別processや外部serviceが必要なら独立した冪等key・reconciliation・kill switchを要求する。
- drain診断は件数counterだけをhealth snapshotへ集約し、message payloadやsource URL/headerをoperational evidenceへ複製しない。


## Retention / GC

Operational GCは完全未参照rawだけを対象とする。manifest pin、capture link、parse run、domain observationのいずれかが存在するrawは候補にしない。

削除手順は次である。

1. `gc_intent`をappend
2. evidence tombstoneをappend
3. hash再検証後にraw bodyを削除
4. `gc_deleted`をappend

途中停止したintentは`gc_recovered`として再開する。証拠metadataは削除せず、pinned evidenceを容量対策で削除しない。実sidecarではGCを`OFF`にし、actual delete canaryは破棄可能なrestore copyだけで行った。

## Backup / restore / rollback

SQLite `VACUUM INTO`でWAL-safe copyを作り、`quick_check`、schema contract、SHA-256、restore後hash一致を検証する。rollbackは新しいconfig eventとしてshadow/GCをOFF、kill switchをONにする。旧configやauditを上書きしない。

Sidecar停止時も`data/boat.sqlite`とLegacy collectorは独立して継続する。緊急時はwriterを停止し、sidecarをread-only隔離する。primary DBのrollbackやschema変更は不要である。

## Completion gate

次を実測してPASSした。

- DB copy、migration時間
- backup/restore、hash一致
- WAL writer lockのbounded failureと復帰
- uncommitted transactionのcrash rollback
- disk容量、quota、low-water
- rollback、kill switch
- old reader compatibility
- partial migration resume
- bounded outbox、retry、idempotency、backpressure
- operational GC audit/recovery
- primary DB schema / `app_settings` fingerprint不変
- shadow default OFF
- primary continuation after shadow failure

F0-R固有contract `FC08B`、`FC12`、`FC14B`は完了した。

## CLI

```sh
# temp/root指定のreadiness。data/boat.sqliteはread-only監査
# 先に同じtemp sidecarへ全field明示のsimulated approvalを記録する
pnpm research:rollout:dry-run -- --root=/tmp/boat-pon-f0r

# 実sidecarのreadiness再検証。新しいbackupとreportを作る
pnpm research:rollout:readiness
```

後者は外部HTTPやlive collector接続を行わないが、sidecar、backup、reportへ追記する。日常のhealth checkとして無目的に連続実行しない。

## 次工程

Phase N1「全券種払戻基盤」のschema/migration実装前レビューは`CONDITIONAL`で完了した。詳細は[`n1-all-bet-type-payout-review.md`](n1-all-bet-type-payout-review.md)。

Phase N1-A offline foundationは`COMPLETE`、Phase N1-B Permanent Settlement Schema Rollout & Capacity Gateは`CONDITIONAL`である。N1-Bで`n1-settlement.0.1`を永続sidecarへzero-dataで適用し、実archive sampleで容量・evidence pin・backup/restore・primary read-only境界を実測した。full backfill projected DB ≈10.5GBは現1GiB quotaに収まらず、evidence pin ≈23M行の重複をOption Bで削減する方針。詳細は[`n1-settlement-permanent-rollout.md`](n1-settlement-permanent-rollout.md)と[`n1-settlement-backfill-design.md`](n1-settlement-backfill-design.md)。N1-C historical backfill、future collector、外部取得は別の明示承認まで開始しない。


## Read-only operability gate

`shadow-operability-v1`はoutbox message/最新attemptと、指定windowの`shadow_outbox_drain` health snapshotだけを読む。queued、ready、oldest age、retrying、permanent failure、retry exhaustion、contention rate、handler deadlineを集約し、versioned policyの明示thresholdへ照合する。出力はPASS/WARN/BLOCKEDと理由、決定的digestであり、message payloadを含めない。

retry上限到達は将来attemptから`SHADOW_RETRY_EXHAUSTED`を保存する。過去rowを現configから推測して書き換えない。malformed timestamp/diagnostics/counterはfail-closed。production thresholdのdefaultは設けず、実sidecar canary前にpolicy承認・rollback条件を別途固定する。このreportのPASSだけでlive writerを許可しない。


## Operability policy approval / CLI

policy fileは`config/shadow-operability-policy.schema.json`へ適合し、全thresholdを明示する。policy canonical digestはapproval target contract `shadow-operability-policy-v1:<digest>`へ埋め込む。既存append-only approval grant/lifecycle resolverを使い、simulated grantはproduction modeで無効、revoked/superseded grantも無効である。policy変更時は別digestへの新approvalが必要になる。

```sh
pnpm report:shadow:operability -- \
  --sidecar=/path/to/quiescent-snapshot.sqlite \
  --policy=/path/to/approved-policy.json \
  --as-of=2026-08-02T05:00:00.000Z \
  --mode=simulated
```

CLIはsidecarを`immutable=1/readOnly/query_only`で開き、非空`-wal`を検出した場合は拒否する。active writer DBを直接監査せず、checkpoint済みquiescent snapshotを使う。exit codeはPASS=0、WARN=2、BLOCKED=3。report PASSはwriter許可ではなく、production approval、snapshot identity、canary、rollback rehearsalを別gateとして要求する。
