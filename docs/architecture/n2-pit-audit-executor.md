# N2 PIT Audit Executor

Status: registered integration; queue migration and one-shot execution pending
Task: `TASK-N2-011`
Safety: L0, read-only
Date: 2026-08-05

## Purpose

Revalidate prediction-time feature sources after the N2 corrected dataset manifest is complete. The audit detects:

- same-race post-race evidence used as a feature;
- feature or live-market availability after the race decision cutoff;
- live-market capture after the cutoff;
- availability later than capture;
- missing or invalid decision cutoffs;
- ambiguous or contradictory lineage timing;
- incomplete raw-document / parse-run lineage;
- non-allowlisted source types.

It does not train a model, alter a dataset, write either SQLite database, change Current BUY, send LINE, promote a strategy or expose raw race identities in the report.

## Components

- pure audit core: `src/research-replay/n2PitAudit.ts`
- immutable SQLite reader: `src/research-replay/n2PitAuditReader.ts`
- standalone executor: `src/automation/n2PitAuditExecutor.ts`
- preserved legacy executor core: `src/automation/taskExecutorsCore.ts`
- canonical registry facade: `src/automation/taskExecutors.ts`
- pure and SQLite tests:
  - `src/research-replay/n2PitAudit.test.ts`
  - `src/research-replay/n2PitAuditReader.test.ts`
  - `src/automation/n2PitAuditExecutor.test.ts`
  - `src/automation/n2PitAuditRegistration.test.ts`
  - `src/automation/n2PitAuditIntegration.test.ts`

## Registration boundary

The previous executor file is preserved byte-for-byte as `taskExecutorsCore.ts`. The canonical `taskExecutors.ts` facade re-exports the existing implementations and extends only the allowlisted resolver with:

```text
pit-audit -> runN2PitAuditExecutor
```

Arbitrary task types continue to return `EXECUTOR_NOT_REGISTERED`. The global registry identity advances to `n2-task-executor-registry-v3` so N2-011 cannot reuse an older idempotency identity.

## Source boundary

Only these observation types are read as feature inputs:

```text
official_program
trifecta_market
```

Known post-race source types are explicitly classified as same-race leakage when presented to the audit core:

```text
official_result
race_result
settlement
payout
refund
decision_outcome
```

The SQLite reader query itself allowlists only the two pre-race source types. Result/settlement tables are not read.

## Decision cutoff

The cutoff is reconstructed only from a matching `official_programs` identity and `close_at`:

```text
canonical key: YYYY-MM-DD:venue:RraceNo
primary race ID: YYYYMMDD-venue-zeroPaddedRaceNo
close_at: JST HH:mm or HH:mm:ss
```

Missing, malformed or mismatched program rows produce an ambiguous-timing exclusion. Race date alone is never used as a substitute cutoff.

## Lineage

Each sidecar observation must pass the existing `verifyN2FeatureLineage` chain:

```text
domain_observation
-> successful parse_run
-> same raw_document
-> verified integrity
-> passed security scan
-> parser replay eligible
-> official_public source
-> valid source timing order
```

Official program availability is validated with `validateFeaturePIT`. Live trifecta checkpoints are validated with `validateOddsUsage` using captured time, available time and cutoff together.

## Result semantics

- `PASS`: at least one real observation exists and every audited observation is safe;
- `CONDITIONAL`: no real observation exists, or one or more observations are excluded without a demonstrated future/same-race leak;
- `FAILED` in the pure summary: future or same-race leakage exists;
- `BLOCKED` in the executor: SDK PIT evidence detects a future, same-race, ambiguous or truncated audit condition.

The executor writes `reports/n2/n2-pit-audit.json` only after input, PIT and write-scope checks pass. A future/same-race violation is retained in runner history and is not mislabeled PASS.

## Input gates

The executor requires:

- `TASK-N2-010=PASS` in the task-state view;
- a valid `n2-dataset-manifest-v2` artifact;
- manifest output-digest recomputation success;
- holdout exclusion confirmed;
- manifest marked read-only;
- `data/research-replay.sqlite` present with no active WAL;
- sibling `data/boat.sqlite` present with no active WAL.

Both databases are opened through immutable read-only URIs with `PRAGMA query_only=ON`. The reader is bounded at 100,000 observations and detects truncation with `limit + 1`.

The one-shot workflow materializes the exact dataset manifest from `automation/boat-pon-research` alongside the control state. It does not fall back to a main-branch fixture or regenerate the manifest.

## Queue migration

After this integration reaches `main`, the automation branch may be changed only when all of these exact preconditions still hold:

1. `TASK-N2-010.status` is `PASS`;
2. `TASK-N2-011.status` is `BLOCKED_EXECUTOR_PENDING`;
3. `TASK-N2-011.taskDefinitionVersion` is `1`;
4. `TASK-N2-011.attemptCount` is `0`;
5. `TASK-N2-011.evidenceLinks` is empty;
6. catalog definition `2` is `READY` and `pit-audit` resolves as implemented;
7. the queue-state blob SHA has not changed since readback.

The migration changes only:

- catalog version to `2026-08-05-n2-governance-v3`;
- queue `stateVersion += 1`;
- queue `updatedAt`;
- N2-011 status to `READY`;
- N2-011 task definition version to `2`;
- N2-011 `updatedAt`.

Authority, attempts, evidence, result digest, failure and checkpoint remain empty. Reapplying the migration to the already-migrated state is a no-op; any different starting state blocks.

## Runtime non-interference

Registration, migration and execution do not modify:

- Current BUY or selector/model parameters;
- LINE content, timing or delivery state;
- operational database schema or rows;
- `app_settings`;
- sidecar or primary database contents;
- holdout contents;
- production approval;
- Cloudflare deployment;
- automated betting.
