# N2 official-program bounded canary

## Purpose

`TASK-N2-012` proved that the primary database contains recent official-program source rows while the research sidecar contains no `official_program` observations. This component defines the smallest reviewed path for turning a bounded set of existing primary-cache rows into typed, lineage-complete sidecar observations.

It does not enable the global shadow rollout and it does not create an approval.

## Current evidence

The Mac read-only validation over the latest seven-day cohort (`2026-07-30` through `2026-08-05`) found:

- 1,013 primary `official_programs` rows;
- 1,011 rows with a valid identity, valid typed payload and `imported_at` before the race cutoff;
- 2 rows excluded as `POST_CUTOFF_PRIMARY_IMPORT`;
- no source-read truncation;
- 20 deterministic canary candidates;
- zero primary writes.

These counts are evidence for canary feasibility, not permission to write the production sidecar.

## Identity boundary

The primary database currently uses venue-label race IDs such as:

```text
20260730-びわこ-01
```

Older fixtures may use the venue-code form:

```text
20040101-11-01
```

Only those two exact encodings are accepted. Both map to the same sidecar canonical identity:

```text
2004-01-01:11:R1
```

Arbitrary aliases are rejected. The selected primary identity and its encoding are sealed into the manifest.

## Manifest contract

The manifest is capped at 20 races and binds:

- manifest and selection-policy versions;
- the exact seven-day cohort;
- primary table identity;
- total source-row count;
- eligible and excluded counts;
- digest of every exclusion reason;
- maximum canary size;
- exact code Git SHA;
- primary race identity and encoding;
- canonical sidecar race identity;
- decision cutoff and observed time;
- SHA-256 of raw JSON bytes;
- SHA-256 of the source reference.

Raw JSON and local source paths are never included in the manifest. A truncated source read cannot produce a manifest.

## TASK-N2-013 review bundle

`TASK-N2-013` is an L0/read-only task that converts the live manifest candidate into a review artifact. It runs only after `TASK-N2-012` is `PASS`.

The bundle seals:

- the exact 20 selected primary identities;
- the exact checkout `HEAD` used by the executor;
- the manifest digest and code SHA;
- the exact source-specific approval target;
- current official-program and trifecta-market observation counts;
- current global shadow and kill-switch state;
- current approval-resolution result;
- the hard maximum of 20 races;
- the `EXISTING_CACHE` lineage mode;
- append-only rollback and quarantine requirements.

A task-level `PASS` means only that the bundle was generated, verified and stored. The bundle always contains:

```text
writeAuthorized: false
productionApplyExecuted: false
humanApprovalCreated: false
executionContract.productionApplyAuthorized: false
```

The bundle may report `READY_FOR_HUMAN_REVIEW`, but that status is not a write approval. A later canary must check out the exact sealed SHA and independently resolve a human production approval for the exact manifest digest at apply time.

The review task opens both SQLite databases immutable/query-only, does not call the canary apply function, does not create approval rows and does not modify rollout state.

## Approval contract

A write requires one active production approval with exact values derived from the manifest digest:

```text
approval_scope: N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY
target_stage: N2-OFFICIAL-PROGRAM-CANARY
target_schema_version: <rollout schema>@<sidecar schema>
target_contract_version: n2-official-program-observation-canary-v1:<manifest digest>:<approval contract version>
```

A generic F0 rollout approval, a simulated approval, an approval for another manifest, or a revoked/superseded approval does not pass.

The apply boundary resolves this approval itself. A caller cannot bypass the gate by supplying a fabricated `approved: true` result.

## Runtime gates

Every apply requires:

- production execution mode;
- exact code SHA match;
- no active WAL;
- sufficient disk;
- kill switch not engaged;
- global `shadow_write_enabled` still false;
- exact production approval;
- unchanged primary rows since manifest generation;
- at least one selected row and no more than 20.

Any mismatch blocks before capture evidence is written.

## Lineage semantics

Existing primary-cache bytes are recorded with:

```text
method: EXISTING_CACHE
source_type: official_program
source_published_at: null
timing_quality: observed_only
```

The canary does not pretend that cached rows were freshly fetched from the official site. It preserves exact raw bytes, parser identity and the observed timestamp already present in the primary database.

Exact replay reuses the existing typed observation. It does not create a duplicate observation or duplicate capture attempt.

## Isolation

This foundation does not change:

- Current BUY or WATCH decisions;
- selector/model parameters;
- LINE content, state or delivery;
- `app_settings`;
- primary database schema or rows;
- global shadow configuration;
- production approvals;
- holdout data;
- Cloudflare deployment;
- betting behavior.

Tests and Mac rehearsal write only to temporary sidecar/raw-store paths and verify the primary database remains unchanged.

## Required next review

Before a real production-sidecar canary:

1. generate and persist one `TASK-N2-013` review bundle from the current checkout SHA;
2. review its counts, exclusions, exact 20 identities, manifest digest and approval target without exposing raw payloads;
3. review the no-delete rollback and quarantine/supersession path;
4. create one human production approval bound to that exact digest only after explicit authorization;
5. check out the exact sealed SHA and rerun all runtime gates;
6. run once with a hard maximum of 20;
7. verify sidecar lineage, PIT audit visibility and idempotent replay;
8. keep global shadow writes disabled;
9. do not consume `TASK-N2-011`'s final attempt until both official-program and trifecta-market observations are non-zero.
