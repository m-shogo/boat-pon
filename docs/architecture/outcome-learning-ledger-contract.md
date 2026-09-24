# Outcome Learning Ledger Contract

Status: architecture contract; implementation pending  
Date: 2026-09-24  
Scope: K3 evaluation memory only  
Production authority: none

## Purpose

The Outcome Learning Ledger binds an immutable Runtime Decision Ledger event to a final, provenance-bearing race/ticket outcome without changing Current BUY, LINE, production settings, public publishing, or model behavior.

It is §8 step 3 of `research-knowledge-retention-contract.md`. It consumes only decision identities that satisfy the Runtime Decision Ledger contract and settlement/result evidence whose identity and finality are independently provable.

## Dependency and authority

Authoritative inputs:

- `docs/architecture/runtime-decision-ledger-contract.md`;
- `reports/research/k1-runtime-decision-inventory-20260924.md`;
- immutable/provable result, refund and invalidation evidence from the existing operational evidence layer.

The current K1 inventory shows that `decision_history.result`, `payout_yen`, `popularity`, `returned` and `race_results.race_id` provide partial race-level settlement evidence, but do not prove an immutable settlement identity or exact linkage to a specific historical decision revision. Therefore copied operational result fields are reconciliation inputs, not automatically canonical outcome events.

## Canonical identity

Every exact outcome record MUST carry:

- `outcomeRecordId`: deterministic immutable identity under a versioned canonicalization protocol;
- `decisionRecordId`: exact Runtime Decision Ledger `recordId`;
- `decisionId`: the corresponding immutable decision identity;
- `canonicalRaceId`;
- ticket type and selection identity;
- `settlementId`: deterministic identity for the final settlement/refund/invalidation event;
- source evidence digest(s) and evidence/provenance version;
- `settledAt` or equivalent authoritative finalization timestamp when provable.

A race ID alone is not sufficient decision-to-outcome identity. A mutable `decision_history` row ID alone is not sufficient either.

Same `outcomeRecordId` + same canonical digest is an idempotent no-op. Same identity + different canonical payload is an integrity conflict and fails closed.

## Outcome semantics

The canonical record distinguishes these concepts rather than collapsing them into a single payout field:

- race/ticket result identity;
- gross stake used by the fixed evaluation protocol;
- gross payout/return;
- refund amount and refund reason when applicable;
- invalid/cancelled/no-contest state;
- whether the ticket was evaluable under the protocol;
- finality state;
- popularity/rank only when supported by the settlement evidence;
- reconciliation state and evidence digest.

`returned=true` from legacy operational state is not by itself sufficient to decide whether an event was a refund, invalidation, cancellation, payout, or another terminal semantic. The mapper must prove the meaning from authoritative evidence or leave it unresolved.

## Finality

Comparable K3 evaluation MUST use only terminal outcomes whose finality is proven.

Proposed finality states:

- `FINAL`: authoritative settlement is complete and identity is unambiguous;
- `PENDING`: result exists but authoritative finality is not yet proven;
- `REVISED`: a prior observed settlement was superseded by a later authoritative settlement; retained as lineage, never silently overwritten;
- `VOID`: authoritative evidence establishes cancellation/invalidation/no-contest semantics;
- `UNRESOLVED`: available evidence cannot establish exact terminal semantics.

A later observation must not mutate historical evidence meaning. Revisions are linked events/facts with provenance. Evaluation selects the terminal authoritative state according to a frozen protocol.

## Reconciliation states

Before admission, every candidate is classified:

- `EXACT`: decision identity, settlement identity, ticket/race linkage, outcome semantics and finality are provable;
- `UNRESOLVED_DECISION`: source cannot bind to an exact Runtime Decision Ledger record;
- `UNRESOLVED_SETTLEMENT_IDENTITY`: race-level evidence cannot prove one immutable settlement event;
- `UNRESOLVED_TICKET_LINK`: settlement is known but exact ticket/selection linkage is ambiguous;
- `UNRESOLVED_REFUND_OR_INVALIDATION`: terminal monetary/invalidation semantics are ambiguous;
- `UNRESOLVED_FINALITY`: evidence exists but final authoritative state is not provable;
- `CONFLICT`: one deterministic identity resolves to different canonical payloads;
- `REJECTED_INVALID`: candidate is provably malformed or violates the outcome validator.

Only `EXACT` records with protocol-accepted terminal finality may enter comparable K3 outcome evaluation. Unresolved candidates remain durable sanitized reconciliation findings and are never filled with guessed values.

## Refund, invalidation and ROI boundary

Evaluation MUST preserve gross result separately from refunds/invalid/cancelled outcomes. It must not convert unknown or void outcomes into losses merely to make a denominator complete.

The frozen evaluation protocol defines:

- whether refunded stake is excluded from stake-at-risk or represented separately;
- how void/cancelled/no-contest events affect cohort counts;
- whether revised settlements invalidate an earlier evaluation artifact;
- which finality states are admissible;
- monetary units and rounding rules.

These rules are protocol metadata, not mutable fields inferred after seeing ROI.

## Decision/outcome separation

Outcome evidence never rewrites the Runtime Decision Ledger. The decision record remains the point-in-time statement of what was known and decided before the result.

Outcome persistence MUST NOT:

- add post-result facts to decision-time evidence;
- relabel future information as pre-race evidence;
- recompute the historical decision with current code;
- treat a profitable outcome as promotion evidence by itself;
- change BUY/WATCH/SKIP behavior.

## Read-only reconciliation plan

The first implementation remains shadow/read-only:

1. read exact Runtime Decision Ledger candidates from an isolated research input;
2. read existing result/refund/invalidation metadata without production mutation;
3. canonicalize source settlement evidence and compute source digests;
4. bind by independently provable race/ticket/decision identity;
5. classify reconciliation and finality;
6. emit outcome records only for `EXACT` candidates;
7. retain sanitized unresolved/conflict findings separately;
8. verify a second identical run is byte/digest stable and creates no duplicates;
9. report inspected/exact/unresolved/conflict/rejected counts from actual evidence only.

No readiness count may be invented, and missing private evidence must remain missing.

## Evaluation admission

An Outcome Learning Ledger record is eligible for a comparable evaluation only when:

- its Runtime Decision Ledger dependency is exact and protocol-admissible;
- race, ticket and selection identity are unambiguous;
- settlement identity and finality are proven;
- refund/invalidation semantics are explicit;
- source provenance/digest is retained;
- the evaluation protocol was frozen independently of the observed result.

Historical, validation, holdout, shadow-forward and future-only stages remain distinct. Outcome linkage does not authorize mixing stages or cohorts.

## Production isolation

This contract and its first implementation MUST NOT:

- write `decision_history`, `race_results`, notification state, `app_settings`, or any production table;
- send, retry or suppress LINE;
- activate dormant/protected N2 tasks;
- connect scheduled research to Current BUY;
- place or automate bets;
- publish private outcome/odds values;
- create a Promotion or alter a selector/model;
- infer readiness from unavailable private data.

Research artifacts contain identities, sanitized metadata, digests, protocol state and aggregate counts only; private raw evidence stays in its approved local authority.

## Required implementation artifacts

Before this ledger can be called implemented, a later research-only PR must add:

- versioned TypeScript record/reconciliation types;
- strict JSON Schema with unknown-field rejection;
- validator for identity, monetary values, timestamps and terminal semantics;
- canonical SHA-256 digest;
- idempotency and same-ID/different-payload conflict tests;
- tests proving unresolved refund/finality/ticket linkage cannot be coerced into exact records;
- production-isolation checks;
- fixture/temp-store reconciliation tests with no private values.

## Dependency boundary

This contract completes the design portion of §8 step 3. It does not claim the Outcome Learning Ledger implementation or backfill is complete.

The next safe slice is the research-only schema/type/validator/test implementation for this contract. §8 step 4 Forward Evaluation Vault must not treat the ledger as available until those checks exist and exact outcome records can be produced without production mutation.

## Learning-gate normalization

- `fingerprintKey`: `research-k3.outcome-learning-ledger-contract`
- `attemptSignature`: `runtime-decision-to-final-outcome-contract-v1`
- `environmentKey`: `github-canonical-main-research-only`
- `materialStateKey`: `runtime-ledger-0.1-reconciliation-contract@80a3acf5`

Gate action: `PROCEED`. This is the next dependency-ordered K3 architecture step; no matching failure learning was found and no protected N2 attempt is consumed.

## Classification

`NO_NEW_LEARNING` for the Learning Fingerprint registry. This is planned K3 architecture work, not a new execution failure or a non-obvious reusable execution guardrail.