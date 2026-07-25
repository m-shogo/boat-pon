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
