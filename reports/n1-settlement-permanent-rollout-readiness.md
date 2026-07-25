# Phase N1-B permanent settlement schema rollout readiness

- status: **CONDITIONAL**
- applied: **true**
- approval: **APPROVAL_VALID** (approved=true)
- schema: before `n1-settlement.0.1` → after `n1-settlement.0.1` (target `n1-settlement.0.1`)
- checksum: `35903ee175dbb31cbc7202aa573a2e1b4f6d58d9b6954cfac4cee0fdfa4eb94d` matches=true
- append-only triggers: 14
- permanent N1 row counts: {"settlement_candidates_v2":0,"race_payout_lines_v2":0,"race_refund_lines_v2":0,"settlement_evidence_pins_v2":0,"settlement_conflict_groups_v2":0,"settlement_conflict_members_v2":0,"settlement_resolution_events_v2":0}

## Approval

- scope: `N1_PERMANENT_SETTLEMENT_SCHEMA_ROLLOUT`
- target: `N1-B` / `n1-settlement.0.1` / `n1-settlement-rollout-v1`
- resolver: `f0r-approval-resolver-v1` / approval id: `n1b-permanent-settlement-schema-rollout-20260725`
- mode: `production`

## Primary isolation (data/boat.sqlite read-only)

- read-only connection: true / query_only: true
- primary write statements: 0 / write connections: 0
- target is sidecar (not primary): true
- schema hash unchanged: true
- attached databases: []

## Pre-migration gate

- shadowWriterOff: PASS
- operationalGcOff: PASS
- outboxQueueEmpty: PASS
- integrityOk: PASS
- foreignKeyOk: PASS
- rolloutSchemaOk: PASS
- diskFreeBytes: 421788708864
- quotaBytes: 1073741824
- lowWaterBytes: 2147483648
- backupDirWritable: PASS
- targetIsSidecarNotPrimary: PASS

## Post-migration gate

- schemaVersionMatches: PASS
- checksumMatches: PASS
- noPartialMigration: PASS
- noUnknownSchema: PASS
- integrityOk: PASS
- foreignKeyOk: PASS
- appendOnlyTriggerCount: 14
- f0ReaderCompatible: PASS
- f0rReaderCompatible: PASS
- n1ReaderCompatible: PASS
- shadowWriterOff: PASS
- operationalGcOff: PASS
- outboxQueueEmpty: PASS
- zeroDataN1: PASS

## Restore-copy canary

- fixtures: 20
- fixtureCandidates: 17
- sampleIngestCandidates: 0
- idempotencyHeld: true
- conflictCreated: true
- correctionApplied: true
- evidencePinsPerCandidate: 3
- appendOnlyEnforced: true
- gcPinRespected: true
- parseErrorCreatesNoCandidate: true
- backupRestoreHashMatch: true

## Gates

- humanApproval: PASS
- primaryReadOnly: PASS
- primaryWriteZero: PASS
- targetIsSidecar: PASS
- preMigrationGate: PASS
- backupCreated: PASS
- schemaApplied: PASS
- checksumMatches: PASS
- appendOnlyTriggers: PASS
- integrityOk: PASS
- foreignKeyOk: PASS
- zeroDataN1: PASS
- f0ReaderCompatible: PASS
- f0rReaderCompatible: PASS
- canaryFixtures: PASS
- canaryIdempotency: PASS
- canaryConflict: PASS
- canaryCorrection: PASS
- canaryAppendOnly: PASS
- canaryGcPin: PASS
- canaryBackupRestore: PASS
- primaryUnchanged: PASS
- shadowWriterOff: PASS

## N1-C eligibility

- status: **CONDITIONAL**
- projected full N1 store exceeds current 1GiB quota; raise quota/low-water before backfill
- evidence pin redundancy (~3 rows/candidate, ~19M projected) should adopt candidate-FK implicit pin (Option B) before backfill
- backfill chunk/checkpoint executor not yet implemented (design only)
- future result collector requires separate approval

## Blockers

- none
