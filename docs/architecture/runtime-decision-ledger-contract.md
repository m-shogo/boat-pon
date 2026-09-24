# Runtime Decision Ledger Contract

Status: contract implemented; persistence mapper pending  
Date: 2026-09-24  
Schema: `runtime-decision-ledger.0.1`

## Purpose

The Runtime Decision Ledger preserves exactly what a decision system knew and decided at decision time without changing Current BUY behavior.

It is the K3 bridge between existing operational decision evidence and future Outcome Learning / Forward Evaluation. It is not a selector, model, notification sender, production writer or automatic retraining mechanism.

## Authority and implementation

- Type and validator: `src/research/governance/runtimeDecisionLedger.ts`
- JSON Schema: `config/research-governance/runtime-decision-ledger.schema.json`
- Tests: `src/research/governance/runtimeDecisionLedger.test.ts`
- K1 field inventory: `reports/research/k1-runtime-decision-inventory-20260924.md`
- Safe-growth roadmap: `docs/roadmaps/safe-growth-implementation-roadmap-2026-08-05.md`

The K1 inventory is the source-field authority for the first mapper. Existing `decision_history` is mutable operational audit state: an existing race/selection can be updated in place and race replacement can remove sibling rows. The mapper therefore MUST NOT equate a current row with an immutable historical evaluation event unless the required identity and point-in-time evidence are independently provable.

## Required identity

Every exact ledger record carries:

- immutable ledger `recordId`;
- source `decisionId` and optional local `decision_history` row ID;
- canonical race identity;
- decision system;
- strategy, model, feature, manifest and cohort versions;
- evaluation mode;
- ticket type and selection;
- source-row SHA-256 digest.

This prevents decisions from different systems, versions, cohorts or evaluation stages from being silently merged.

`recordId`/`decisionId` MUST be deterministic from a versioned canonical identity protocol before a persistence mapper is admitted. A storage-local row ID alone is not sufficient proof of an immutable evaluation identity. Same identity + same canonical payload is idempotent; same identity + different payload is an integrity conflict and fails closed.

## Decision-time evidence

An exact record retains:

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

The ledger records what the source proves was available at decision time. It MUST NOT rerun current decision code and present the result as the historical decision.

## Point-in-time invariants

The validator fails closed when:

- the decision occurs after the scheduled close observed at that time;
- the odds observation occurs after the decision;
- a BUY lacks an odds observation;
- a BUY lacks current odds, required odds, probability, EV or positive paper stake;
- a BUY is marked partial or blocked;
- probability is outside `[0, 1]`;
- decision-critical values are non-finite.

The first persistence mapper must not derive historical timestamps from the latest known close time. It must use the close-time version visible at decision time or report the source row as unresolved.

`decision_history.created_at` is not automatically an exact `decisionAt`: the operational persistence path can update an existing row while preserving its original creation time. Likewise, `fetched_at` or a nearest `odds_snapshots.captured_at` value is not proof that that snapshot was the one consumed by the decision.

## Historical reconciliation states

The mapper MUST classify each source candidate before attempting ledger admission:

- `EXACT`: immutable decision identity, decision time and all protocol-required PIT evidence are provable;
- `UNRESOLVED_IDENTITY`: one operational row cannot prove one immutable evaluation event;
- `UNRESOLVED_DECISION_TIME`: exact evaluation time is not provable;
- `UNRESOLVED_EVIDENCE`: required decision-time snapshot/close-time evidence is not provable;
- `UNRESOLVED_VERSION`: required historical decision-system/strategy/model/feature version is not provable;
- `CONFLICT`: the same deterministic identity resolves to different canonical payloads;
- `REJECTED_INVALID`: the candidate is provably malformed or violates the ledger validator.

Only `EXACT` candidates may become `runtime-decision-ledger.0.1` records. Unresolved candidates remain reconciliation findings with sanitized source identity/digest and reason; they MUST NOT be coerced into schema-valid ledger records with guessed placeholders.

Unknown historical versions remain unresolved. The current repository/model/strategy/feature version MUST NOT be copied backward to fill a missing historical version.

## Notification separation

The ledger records notification eligibility and a dedupe key but never sends LINE messages.

Rules:

- notification eligibility may only be true for BUY;
- eligible BUY requires a dedupe key;
- LINE delivery success/failure remains in the operational notification authority;
- a notification keyed only by `(race_id, channel)` is race-level evidence, not proof of linkage to a particular decision revision;
- ledger persistence failure must not roll back or retry the BUY/LINE critical transaction;
- Public Web and Cloudflare fields are not allowed in the record.

## Outcome separation

The Runtime Decision Ledger does not reinterpret copied result fields as a final immutable outcome event. Race-level result/settlement association may be retained as reconciliation evidence, but exact decision-to-outcome linkage, refunds, invalidation and finality belong to the Outcome Learning Ledger (§8 step 3).

A settlement copied by race proves race-level association only; it does not prove that every historical decision revision for that race has an exact immutable outcome linkage.

## Unknown-field rejection

The runtime validator and JSON Schema reject additional properties. This prevents later code from quietly adding:

- public snapshot URLs;
- analytics or advertisement data;
- mutable post-result labels;
- unversioned training flags;
- production approval state.

A schema change requires a new version and migration/reconciliation plan.

## Digest and idempotency

`runtimeDecisionLedgerDigest()` computes SHA-256 over recursively canonicalized JSON key order.

The digest protects the complete record. `sourceRowDigest` separately identifies the source operational row/input used by a future mapper.

For a future append-only store:

- same `recordId` + same canonical digest: idempotent no-op;
- same `recordId` + different canonical digest: fail-closed conflict;
- operational UPDATE/delete/replace does not mutate or delete a previously retained ledger event;
- newly discovered provenance is a separately versioned reconciliation fact, not an in-place rewrite of historical meaning.

## Read-only backfill / reconciliation plan

The first mapper remains a projection and audit, not a repair of production history:

1. read `decision_history` and associated notification/result/snapshot metadata without mutation;
2. map only source fields whose historical semantics are provable;
3. compute deterministic source-row digest and candidate identity;
4. classify the candidate using the reconciliation states above;
5. validate and emit a ledger record only for `EXACT` candidates;
6. retain sanitized unresolved/conflict reasons separately from ledger records;
7. produce mapped/rejected/unresolved/conflict counts from evidence actually inspected; never invent readiness counts;
8. verify a second identical run is byte/digest stable and does not duplicate records.

The mapper MUST NOT select a later/nearest odds observation merely to make an incomplete historical row admissible. Missing PIT evidence remains missing.

## Admission to comparable K3 evaluation

An event may enter an evaluation requiring exact point-in-time market evidence only when the evaluation protocol's required fields are proven. At minimum, an exact-PIT protocol requires:

- exact immutable decision identity;
- exact decision timestamp;
- exact/protocol-approved decision-time evidence binding;
- explicit decision-system/model/version context;
- unambiguous race/selection identity.

Unresolved operational history may still be useful for descriptive audit, but it is excluded from exact PIT claims. Exclusion and reason are retained rather than silently dropped.

## Current non-goals and production isolation

This slice does not and MUST NOT:

- change Current BUY or selector behavior;
- change `scripts/notify-line.ts` or send/retry/suppress LINE;
- write to `decision_history`, `notification_log`, or `app_settings`;
- add a production SQLite table;
- backfill private local data from CI;
- activate dormant/protected N2 tasks;
- connect Scheduled Tasks to production;
- create a promotion or retrain a model;
- publish records to Cloudflare/Public Web.

A future mapper/writer requires deterministic canonicalization, schema validation, idempotency/conflict tests, unresolved-evidence tests, and existing production-isolation checks before merge.

## Next implementation slice

The next Runtime Decision Ledger PR should remain read-only and shadow-only:

```text
existing decision_history rows
-> canonical source adapter
-> reconciliation classification
-> ledger validator for EXACT candidates only
-> temporary/isolated output
-> source vs ledger reconciliation report
```

Acceptance criteria:

- no write to the operational DB;
- deterministic record and digest;
- idempotent mapping;
- duplicate identity with different content fails closed;
- unresolved timestamps, versions or evidence are reported, not guessed;
- no Current BUY, LINE sender, `app_settings`, production or public imports;
- fixture and temp-store tests;
- completion report includes mapped, rejected, unresolved and conflict counts.

## Dependency boundary

This contract completes the §8 step 2 contract/reconciliation design on top of the merged K1 inventory. It does not claim the persistence mapper is complete.

The next architecture dependency is §8 step 3: define the Outcome Learning Ledger contract linking immutable decision/reconciliation identities to final outcomes, refunds, invalidation and finality. That work must preserve the unresolved/ambiguity rules above and must not change Current BUY.

## Learning-gate normalization

- `fingerprintKey`: `research-k3.runtime-decision-ledger-contract`
- `attemptSignature`: `k1-inventory-to-existing-ledger-contract-reconciliation-v1`
- `environmentKey`: `github-canonical-main-research-only`
- `materialStateKey`: `runtime-ledger-0.1-plus-k1-inventory@930b8610`

Gate action: `PROCEED`. This is a materially distinct planned architecture step based on the newly merged K1 inventory; it does not consume an N2 attempt.

## Classification

`NO_NEW_LEARNING` for the Learning Fingerprint registry. This is planned K3 architecture/reconciliation work, not a new execution failure or non-obvious reusable execution guardrail.