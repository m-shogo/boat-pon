# N2 Trifecta Market Read-only Foundation

Status: implementation foundation only; production sidecar apply is not authorized  
Source type: `trifecta_market`  
Approval scope reserved: `N2_TRIFECTA_MARKET_OBSERVATION_CANARY`  
Safety: L0 until a separate reviewed approval/apply task exists

## Why this exists

`TASK-N2-011` has completed against 20 verified `official_program` observations. The production sidecar still contains zero `trifecta_market` observations. `TASK-N2-020` must therefore not produce a real-data market baseline from an empty table, aggregate-only rows, or fixtures.

This foundation defines the evidence that must exist before a bounded trifecta-market canary can be proposed. It does not create an approval, enable shadow writes, write the sidecar, or execute a production apply.

## Source inventory

The immutable reader inspects these primary tables in priority order:

1. `trifecta_market_raw_snapshots`
2. `odds_timeseries_snapshots`
3. `odds_timeseries`

The latest seven-day cohort is anchored to `MAX(official_programs.date)`. The reader records rows, races, checkpoint identities, complete 120-selection snapshots, and the availability of these columns:

- `raw_document_id`
- raw payload (`raw_payload`, `raw_json`, or `response_body`)
- raw payload digest (`raw_payload_digest`, `payload_sha256`, or `raw_sha256`)
- `parse_run_id`
- `source_url`
- `captured_at`
- `available_at`
- `decision_cutoff`
- `checkpoint_label`

Aggregate odds rows remain useful inventory. They are not silently relabeled as raw official source documents.

## Typed payload completeness

Every candidate checkpoint must contain exactly the 120 ordered three-boat permutations from boats 1 through 6.

The audit rejects:

- fewer or more than 120 rows;
- fewer or more than 120 distinct selections;
- repeated boats in one selection;
- unknown selections;
- duplicate selections;
- zero, negative, NaN, or infinite odds.

A fixture can prove the validator, but it cannot make the production foundation ready when the real source inventory lacks raw lineage.

## Exact checkpoint identity

The checkpoint identity binds:

- source type;
- race ID;
- checkpoint label;
- capture time;
- raw document ID.

The idempotency key additionally binds the raw payload digest, parse run ID, and proposed observation ID.

Rules:

- same identity and same payload digest: replay may reuse;
- same identity and different payload digest: fail closed;
- duplicate checkpoint identity in one review bundle: block the entire bundle.

## Atomic PIT rule

All three timestamps are mandatory and parsed atomically:

```text
availableAt <= capturedAt <= decisionCutoff
```

This prevents a retrospectively known market value from being treated as available before the decision cutoff. Missing or ambiguous timestamps block the candidate; they are never defaulted from filesystem, import, or race-result time.

## Raw/parse/observation lineage

Each candidate requires:

- raw document ID;
- SHA-256 raw payload digest;
- parse run ID;
- proposed observation ID;
- optional source URL with an HTTP(S) scheme.

A future writer must preserve this chain without recomputing identity from mutable aggregate rows.

## Bounded manifest and review bundle

The builder emits a deterministic, digest-bound manifest with at most 20 races. Its embedded state is always:

```text
writeAuthorized: false
productionApplyExecuted: false
autoCreateApproval: false
autoEnableShadowWrite: false
```

`READY_FOR_HUMAN_REVIEW` means only that a bounded manifest can be reviewed. It does not authorize a write.

When inventory, PIT, payload, lineage, or duplicate-identity checks fail, the status is `BLOCKED_NOT_READY_FOR_CANARY` and the manifest contains zero entries.

## Rollback and revoke conditions

A future approved canary must stop and revoke approval when any of these occurs:

- active WAL or mutable DB access;
- manifest, source schema, raw payload digest, or checkpoint identity drift;
- missing or expired source-specific approval;
- PIT ordering violation;
- incomplete or duplicate selection space;
- raw/parse/observation lineage mismatch;
- insert/reuse/write counts differ from the reviewed manifest;
- any primary DB write;
- sidecar writes outside the approved bounded transaction;
- idempotent replay changes observation identity or payload digest;
- read-only post-apply verification fails.

## Read-only post-verification contract

The foundation fixes the future verification boundary:

- primary DB: immutable and query-only;
- sidecar DB: immutable and query-only;
- no active WAL before execution;
- manifest digest must match;
- observation counts must remain unchanged during foundation/report generation;
- primary write count must be zero;
- sidecar write count must be zero during foundation/report generation;
- any future temporary approval must be revoked after apply.

## Current operational boundary

The report command:

```bash
npx tsx scripts/report-n2-trifecta-market-foundation.ts
```

reads the real primary and sidecar databases through immutable readers and writes only `reports/n2/n2-trifecta-market-foundation.json` in the worktree. It intentionally materializes zero raw snapshot candidates until a reviewed raw-document capture source exists.

No change is made to Current BUY, selector/model parameters, LINE, `app_settings`, primary/sidecar schema or rows, holdout, production approval, Cloudflare, advertising, or automated betting.
