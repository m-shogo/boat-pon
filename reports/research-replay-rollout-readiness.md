# Stage F0-R Research Replay Foundation Rollout

- Status: **COMPLETE**
- Rollout mode: `sidecar_shadow_default_off`
- Sidecar schema: `f0r.2.0`
- Shadow write: **OFF**
- N1: **NOT STARTED**
- Approval gate: **APPROVAL_VALID**

## Gates

- f0Complete: PASS
- dbCopy: PASS
- backup: PASS
- restore: PASS
- walLockIsolation: PASS
- crashRecovery: PASS
- diskCapacity: PASS
- rollback: PASS
- collectorNonRegression: PASS
- oldReaderCompatibility: PASS
- partialMigrationResume: PASS
- shadowDefaultOff: PASS
- primaryFailureIsolation: PASS
- boundedOutbox: PASS
- operationalGcAudit: PASS
- humanApprovalValid: PASS

## Deployment boundary

- Research evidenceは独立sidecarへ配置した。
- `data/boat.sqlite`はread-only fingerprint監査だけを行った。
- live collector、Legacy formal、BUY/WATCH/SKIP、通知、モデルへ接続していない。
- sidecar writerとoperational GCはdefault OFFである。

## Human approval gate

- resolver: `f0r-approval-resolver-v1`
- approval id: `f0r-hardening-explicit-20260724`
- source: `user-explicit-request:F0-R-approval-hardening-and-N1-review`
- reference: `codex-task:bdaf2513`
- approved at: `2026-07-24T04:46:16.000Z`
- target: `F0-R / f0r.2.0 / f0r-approval-v2`
- mode: `production`
- legacy approval rows: 1（v2 gateでは承認として扱わない）
- correction: 旧f0r-start-approval-v1はscope/source/timeだけで対象contractを検証できないため不適格。v2の明示grantとappend-only lifecycleを正本とする。

## Backup / restore

- quick_check: `ok`
- backup bytes: 327680
- backup/restore hash match: true

## Failure isolation canary

- primary continued: true
- outbox replay: true
- GC audited deletion: true
- rollback kill switch: true
- crash transaction rollback: true
- WAL writer recovery: true
- partial migration resume: true

## Next

N1のschema/migration実装前レビューは完了した。parser、migration適用、外部取得、collector接続は別の明示承認を待つ。
