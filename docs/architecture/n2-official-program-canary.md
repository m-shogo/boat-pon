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

1. generate and persist one reviewed manifest from the current main SHA;
2. review its counts, exclusions and selected identities without exposing raw payloads;
3. define rollback and evidence paths;
4. create one human production approval bound to that exact digest;
5. run once with a hard maximum of 20;
6. verify sidecar lineage, PIT audit visibility and idempotent replay;
7. keep global shadow writes disabled;
8. rerun `TASK-N2-011` only after both official-program and trifecta-market observations are non-zero.
