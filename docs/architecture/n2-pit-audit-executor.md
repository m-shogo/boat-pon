# N2 PIT Audit Executor

Status: registered; queue migrated; first dispatch blocked before execution by dirty-worktree input materialization
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
  - `src/automation/n2PitAuditExternalManifest.test.ts`
  - `src/automation/n2PitAuditRegistration.test.ts`
  - `src/automation/n2PitAuditIntegration.test.ts`

## Registration boundary

The previous executor file is preserved byte-for-byte as `taskExecutorsCore.ts`. The canonical `taskExecutors.ts` facade re-exports the existing implementations and extends only the allowlisted resolver with:

```text
pit-audit -> runN2PitAuditExecutor
```

Arbitrary task types continue to return `EXECUTOR_NOT_REGISTERED`. The global registry identity is `n2-task-executor-registry-v3`, so N2-011 cannot reuse an older idempotency identity.

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
- manifest is a regular file, not a symlink, and no larger than 2 MiB;
- `data/research-replay.sqlite` present with no active WAL;
- sibling `data/boat.sqlite` present with no active WAL.

Both databases are opened through immutable read-only URIs with `PRAGMA query_only=ON`. The reader is bounded at 100,000 observations and detects truncation with `limit + 1`.

The one-shot workflow reads the exact dataset manifest from `automation/boat-pon-research`, writes it to `$RUNNER_TEMP/n2-dataset-manifest.json`, and passes the absolute path through `BOAT_PON_N2_DATASET_MANIFEST_PATH`. It does not place this dynamic authority artifact inside the Git worktree, weaken `DIRTY_WORKING_TREE`, fall back to a main-branch fixture or regenerate the manifest.

The executor retains the repository-relative manifest path only as a test/local fallback when the environment variable is absent.

## First dispatch record

Merged intent `INTENT-20260805-m7p3v9k2qx` was guarded successfully on Mac recovery run `31010313396`. The task did not reach the executor. Preflight returned:

```text
BLOCKED: DIRTY_WORKING_TREE
```

Root cause: the first integration wrote the automation-branch manifest to `reports/n2/n2-dataset-manifest.json` before runner preflight. The dirty-tree guard behaved correctly. The blocked run left N2-011 `READY`, attempt count `0`, evidence empty and the intent unprocessed.

The fix moves only that input to `RUNNER_TEMP`; it does not add the manifest path to the dirty-tree allowlist.

## Queue migration

The automation branch migration completed from catalog v2/state v22 to catalog v3/state v23 under blob-SHA CAS. It changed only:

- catalog version;
- queue state version/timestamps;
- N2-011 status from `BLOCKED_EXECUTOR_PENDING` to `READY`;
- N2-011 task definition version from `1` to `2`.

Authority, attempts, evidence, result digest, failure and checkpoint remained empty. The blocked first dispatch did not consume or mutate this task entry.

## Retry authority

The first intent is immutable and remains unprocessed. After this fix reaches main, it must not be edited or silently reused against a newer main SHA. A strict stale-intent supersession record and exactly one replacement intent are required. Existing actor, authority, queue, dependency, replay and one-shot guards remain authoritative.

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
