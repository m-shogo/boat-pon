# N2 Prediction-Time Observation Ingest Readiness

Status: read-only implementation foundation; no sidecar write authorization
Task: `TASK-N2-012`
Safety: L0
Date: 2026-08-05

## Purpose

N2-011 reached the real PIT reader and returned `CONDITIONAL / PENDING_REAL_DATA` because the sidecar contains no `official_program` or `trifecta_market` observations. TASK-N2-012 determines why those sources are absent and whether a bounded observation canary can be designed safely.

A successful TASK-N2-012 run means only that the diagnostic report was generated and verified. It does **not** mean observation writes are authorized.

## Verified current state

Read-only Mac diagnostics established:

- primary `official_programs`: 1,147,173 rows, with raw JSON and close time present;
- primary odds data exists in multiple tables, including 7,140,263 rows in `odds_timeseries`;
- sidecar `domain_observations`: 1,253,519 rows, all `settlement_result`;
- sidecar `official_program`: 0;
- sidecar `trifecta_market`: 0;
- capture attempts/events: 0;
- shadow outbox/delivery attempts: 0;
- latest rollout config: `shadow_write_enabled=0`, `kill_switch_engaged=0`;
- no source-specific official-program or trifecta-market canary approval;
- official-program capture primitives exist, but no production caller is connected;
- no reviewed trifecta-market raw capture and observation writer exists.

The primary source data is not itself N2 observation evidence. It must not be relabeled as official raw lineage merely to make N2-011 pass.

## Read-only inputs

The executor opens sibling `boat.sqlite` and `research-replay.sqlite` through immutable read-only URIs and applies `PRAGMA query_only=ON`. Any active WAL blocks the task; the task never checkpoints or removes it.

The reader uses a deterministic latest seven-day cohort ending at `MAX(official_programs.date)`.

### Official program inventory

The cohort records:

- total rows;
- rows with raw JSON, source file, import time and close time;
- missingness by required source field;
- existing sidecar `official_program` observation count.

### Trifecta market inventory

The reader chooses `odds_timeseries_snapshots` when present and otherwise `odds_timeseries`. It records:

- trifecta rows and races;
- rows with usable capture timing;
- rows with three-character selections and positive odds;
- complete snapshots with exactly 120 distinct trifecta selections;
- whether raw-document identity, raw payload and source URL columns exist;
- existing sidecar `trifecta_market` observation count.

A complete aggregate snapshot is useful for inventory but is not raw official lineage when the source table lacks raw-document identity and payload.

## Rollout and wiring gates

Two source-specific approval scopes are reserved:

```text
N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY
N2_TRIFECTA_MARKET_OBSERVATION_CANARY
```

Each source is blocked when any applicable condition is true:

- kill switch engaged;
- global shadow write disabled;
- source-specific approval missing;
- eligible source data absent;
- reviewed writer/caller not connected;
- market raw lineage unavailable;
- no complete market snapshot.

The readiness report always contains:

```text
writeAuthorized: false
autoEnableShadowWrite: false
recommendedCanaryMaxRaces: 20
```

No task or report automatically changes rollout configuration or creates approvals.

## Result semantics

The executor task can return `PASS` when it safely generates the diagnostic artifact. The artifact independently reports:

- `READY_FOR_BOUNDED_CANARY`; or
- `BLOCKED_NOT_READY_FOR_WRITE`.

These statuses must never be collapsed. A report-level blocked result is an expected, useful diagnostic outcome.

## PIT applicability

The report is an inventory of source availability, rollout state and wiring. It does not join settlement labels or emit prediction features. SDK PIT evidence is therefore `NOT_APPLICABLE` with zero future/same-race/ambiguous counts and the explicit reason:

```text
readiness inventory does not join labels or emit prediction features
```

## Expected next sequence

1. Run TASK-N2-012 read-only and preserve its evidence.
2. Implement an approval-gated official-program canary writer for at most 20 races; do not enable global writes automatically.
3. Implement raw trifecta source capture before market observation writing.
4. Add source-specific approvals and rollback evidence in separate reviewed changes.
5. Produce non-zero `official_program` and `trifecta_market` observations.
6. Only then use the final N2-011 attempt.

## Runtime non-interference

TASK-N2-012 does not modify:

- Current BUY or selector/model parameters;
- LINE content, timing or delivery state;
- primary or sidecar database contents/schema;
- `app_settings`;
- rollout configuration or approvals;
- holdout contents;
- production approval;
- Cloudflare deployment;
- automated betting.
