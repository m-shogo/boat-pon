# Runtime Decision Ledger Contract

Status: contract implemented; persistence mapper pending
Date: 2026-08-05
Schema: `runtime-decision-ledger.0.1`

## Purpose

The Runtime Decision Ledger preserves exactly what a decision system knew and decided at decision time without changing Current BUY behavior.

It is the K3 bridge between existing operational decision evidence and future Outcome Learning / Forward Evaluation. It is not a selector, model, notification sender, production writer or automatic retraining mechanism.

## Authority and implementation

- Type and validator: `src/research/governance/runtimeDecisionLedger.ts`
- JSON Schema: `config/research-governance/runtime-decision-ledger.schema.json`
- Tests: `src/research/governance/runtimeDecisionLedger.test.ts`
- Safe-growth roadmap: `docs/roadmaps/safe-growth-implementation-roadmap-2026-08-05.md`

## Required identity

Every record carries:

- immutable ledger `recordId`;
- source `decisionId` and optional local `decision_history` row ID;
- canonical race identity;
- decision system;
- strategy, model, feature, manifest and cohort versions;
- evaluation mode;
- ticket type and selection;
- source-row SHA-256 digest.

This prevents decisions from different systems, versions, cohorts or evaluation stages from being silently merged.

## Decision-time evidence

The record retains:

- `decisionAt`;
- `oddsObservedAt`;
- `scheduledCloseAtSeen`;
- current and required odds;
- estimated and raw estimated hit rate;
- expected value;
- recommended paper stake;
- sample size;
- reasons and warnings;
- data completeness;
- notification eligibility and dedupe identity.

## Point-in-time invariants

The validator fails closed when:

- the decision occurs after the scheduled close observed at that time;
- the odds observation occurs after the decision;
- a BUY lacks an odds observation;
- a BUY lacks current odds, required odds, probability, EV or positive paper stake;
- a BUY is marked partial or blocked;
- probability is outside `[0, 1]`;
- decision-critical values are non-finite.

The first persistence mapper must not derive historical timestamps from the latest known close time. It must use the close-time version visible at decision time or report the record as unresolved.

## Notification separation

The ledger records notification eligibility and a dedupe key but never sends LINE messages.

Rules:

- notification eligibility may only be true for BUY;
- eligible BUY requires a dedupe key;
- LINE delivery success/failure remains in the operational notification authority;
- ledger persistence failure must not roll back or retry the BUY/LINE critical transaction;
- Public Web and Cloudflare fields are not allowed in the record.

## Unknown-field rejection

The runtime validator and JSON Schema reject additional properties. This prevents later code from quietly adding:

- public snapshot URLs;
- analytics or advertisement data;
- mutable post-result labels;
- unversioned training flags;
- production approval state.

A schema change requires a new version and migration/reconciliation plan.

## Digest

`runtimeDecisionLedgerDigest()` computes SHA-256 over recursively canonicalized JSON key order.

The digest protects the complete record. `sourceRowDigest` separately identifies the source operational row/input used by a future mapper.

## Current non-goals

This slice does not:

- change Current BUY;
- change `scripts/notify-line.ts`;
- write to `decision_history`;
- add a new SQLite table;
- backfill local data;
- connect Scheduled Tasks to production;
- create a promotion;
- retrain a model;
- publish the record to Cloudflare.

## Next implementation slice

The next Runtime Decision Ledger PR should remain read-only and shadow-only:

```text
existing decision_history rows
-> explicit field inventory
-> canonical mapper
-> validator
-> temporary/isolated output
-> source vs ledger reconciliation report
```

Acceptance criteria:

- no write to the operational DB;
- deterministic record and digest;
- idempotent mapping;
- duplicate identity with different content fails closed;
- unresolved timestamps or identities are reported, not guessed;
- no Current BUY, LINE sender, `app_settings`, production or public imports;
- fixture and temp-store tests;
- completion report includes mapped, rejected, unresolved and conflict counts.
