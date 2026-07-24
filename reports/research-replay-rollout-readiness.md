# Stage F0-R Research Replay Foundation Rollout

- Status: **COMPLETE**
- Rollout mode: `sidecar_shadow_default_off`
- Sidecar schema: `f0r.2.0`
- Shadow write: **OFF**
- N1: **NOT STARTED**

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

## Deployment boundary

- Research evidenceは独立sidecarへ配置した。
- `data/boat.sqlite`はread-only fingerprint監査だけを行った。
- live collector、Legacy formal、BUY/WATCH/SKIP、通知、モデルへ接続していない。
- sidecar writerとoperational GCはdefault OFFである。

## Backup / restore

- quick_check: `ok`
- backup bytes: 294912
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

N1は自動開始しない。schema/migration再レビューと別の明示承認を待つ。
