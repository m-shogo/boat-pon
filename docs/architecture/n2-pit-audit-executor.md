# N2 PIT Audit Executor

Status: implementation foundation; not registered in the live executor allowlist
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
- pure and SQLite tests:
  - `src/research-replay/n2PitAudit.test.ts`
  - `src/research-replay/n2PitAuditReader.test.ts`
  - `src/automation/n2PitAuditExecutor.test.ts`

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

## Current integration boundary

This branch intentionally does not modify `EXECUTORS`, task catalog or automation queue state while N2-010 remains unprocessed. Registration and the explicit `BLOCKED_EXECUTOR_PENDING -> READY` migration are separate steps after:

1. the replacement N2-010 intent reaches a verified terminal result;
2. the dataset manifest and lineage are read back;
3. this foundation passes full CI;
4. the integration diff can be applied without advancing `main` underneath an already queued self-hosted run.
