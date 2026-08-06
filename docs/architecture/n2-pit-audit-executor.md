# N2 PIT Audit Executor

Status: production official-program canary verified; reader-v2 validated; final task definition v4 ready for one guarded audit
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

Arbitrary task types continue to return `EXECUTOR_NOT_REGISTERED`. The global registry identity is `n2-task-executor-registry-v3`. The N2-011 task definition advances to v4 and executor contract to v3 after the verified 20-race production official-program canary and reader-v2 primary identity correction.

## Dataset manifest integrity boundary

N2-010 and the Executor SDK create the persisted manifest in two stages:

```text
N2-010 artifact core summary
  -> canonical outputDigest fixed
  -> SDK validates and appends pitEvidence
  -> run/request/task/executor/generatedAt metadata appended
  -> JSON persisted
```

N2-011 therefore validates two distinct integrity layers.

### Core-summary digest

The canonical digest is recomputed after excluding only:

```text
runId
requestId
taskId
executorVersion
generatedAt
outputDigest
pitEvidence
```

Every dataset identity, coverage, holdout, split and read-only field remains inside the digest. A core mutation fails with `N2_DATASET_MANIFEST_OUTPUT_DIGEST_MISMATCH`.

### SDK PIT envelope

`pitEvidence` is not ignored. It is validated separately and must exactly prove that settlement inventory is not a prediction-time feature join:

```text
status = NOT_APPLICABLE
validatorId = settlement-inventory-pit-applicability
validatorVersion = v1
checkedRecordCount = inventoryTotals.candidates
sameRaceViolationCount = 0
futureViolationCount = 0
ambiguousTimingCount = 0
evidencePath = null
evidenceDigest = null
notApplicableReason = settlement inventory does not join prediction-time features
```

Missing, contradictory, mismatched or non-zero PIT envelope fields block before any database audit. This separation matches the producer lifecycle without weakening integrity.

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
primary race ID: YYYYMMDD-venueLabel-zeroPaddedRaceNo or legacy YYYYMMDD-venueCode-zeroPaddedRaceNo
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
- `BLOCKED` in the executor: input, SDK PIT, future, same-race, ambiguous or truncated evidence fails closed.

The executor writes `reports/n2/n2-pit-audit.json` only after input, PIT and write-scope checks pass. A future/same-race violation is retained in runner history and is not mislabeled PASS.

## Input gates

The executor requires:

- `TASK-N2-010=PASS` in the task-state view;
- a valid `n2-dataset-manifest-v2` core summary and SDK PIT envelope;
- manifest core output-digest recomputation success;
- holdout exclusion confirmed;
- manifest marked read-only;
- valid non-negative `inventoryTotals.candidates`;
- manifest is a regular file, not a symlink, and no larger than 2 MiB;
- `data/research-replay.sqlite` present with no active WAL;
- sibling `data/boat.sqlite` present with no active WAL.

Both databases are opened through immutable read-only URIs with `PRAGMA query_only=ON`. The reader is bounded at 100,000 observations and detects truncation with `limit + 1`.

The one-shot workflow reads the exact dataset manifest from `automation/boat-pon-research`, writes it to `$RUNNER_TEMP/n2-dataset-manifest.json`, and passes the absolute path through `BOAT_PON_N2_DATASET_MANIFEST_PATH`. It does not place this dynamic authority artifact inside the Git worktree, weaken `DIRTY_WORKING_TREE`, fall back to a main-branch fixture or regenerate the manifest.

## Guarded execution records

### Run 31010313396 — preflight BLOCK

Intent `INTENT-20260805-m7p3v9k2qx` passed the canonical guard. The task did not reach the executor:

```text
BLOCKED: DIRTY_WORKING_TREE
```

Root cause: the first integration materialized the automation-branch manifest inside the Git worktree. The guard behaved correctly. The input was moved to `RUNNER_TEMP`; no dirty-tree exception was added.

### Run 31011585102 — input-contract BLOCK

Replacement intent `INTENT-20260805-q9v4m2k7px` passed guard, preflight and external-manifest materialization, then reached the executor and returned:

```text
BLOCKED:
- INPUT_CONTRACT
- N2_DATASET_MANIFEST_OUTPUT_DIGEST_MISMATCH
```

No real observation query was executed. Root cause: the consumer recomputed the N2-010 core digest with the SDK-appended `pitEvidence` still included. The blocked result is processed and retained as attempt 1 evidence.

## Retry migration

After the corrected v3 definition reaches main, automation queue migration must use the current queue blob SHA as CAS and preserve:

- `attemptCount: 1`;
- the existing blocked evidence link;
- `maxAttempts: 3`.

It changes only the catalog version, state version/timestamps and N2-011 definition/status fields. N2-011 becomes READY definition v3 with authority/result/failure cleared for a new attempt; prior evidence remains append-only. A new immutable intent is required because the previous replacement intent is processed as BLOCKED.

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

## Verified production observation foundation (2026-08-06)

- exact manifest digest: `151c34786e29ca80838da0fe3b2eb3326ee343d0a3656e8f20666af14d1b3a85`;
- official-program observations: 20 unique selected races;
- capture attempts and joined parse/raw lineage: 20;
- idempotent replay: 0 inserts / 20 reuses;
- SQLite quick check: ok;
- exact production approval: granted once and revoked, current resolution `APPROVAL_REVOKED`;
- global shadow write: OFF;
- primary selected rows: 20/20 hash-verified after WAL cleared;
- trifecta-market observations: 0, therefore the final audit may PASS the observed official-program cohort while recording zero checked odds checkpoints.

Reader v2 resolves both production venue-label IDs and legacy canonical venue-code IDs. Missing, malformed, conflicting or duplicate identities remain fail-closed as ambiguous timing.
