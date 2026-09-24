# Forward Evaluation Vault

Status: canonical K3 architecture contract  
Scope: research-only evaluation memory  
Production authority: none

## Purpose

The Forward Evaluation Vault preserves comparable forward evidence without allowing cohort drift, protocol drift, hindsight relabeling, or accidental mixing of historical, holdout, and forward results. It consumes immutable Runtime Decision Ledger and Outcome Learning Ledger identities; it never changes Current BUY, LINE, production settings, or automated betting.

## Admission boundary

A record may enter a scored forward evaluation only when all of the following are exact and independently verifiable:

- immutable Runtime Decision Ledger identity and digest;
- Outcome Learning Ledger reconciliation state `EXACT`;
- final outcome is explicitly evaluable under the frozen protocol;
- decision time precedes the outcome and all decision evidence satisfies the applicable PIT contract;
- decision system, strategy, model, feature, manifest, ticket, and selection versions are explicit;
- cohort enrollment occurred under a protocol frozen before the evaluated decision;
- no field is reconstructed from later evidence merely to make the row scorable.

Anything unresolved remains retained but is excluded from scored aggregates. Missingness is evidence, not permission to impute hindsight.

## Immutable identities

### Enrollment protocol

`enrollmentProtocolId` identifies the prospective rule that determines whether a race/decision is eligible to enter a cohort. Its canonical payload and digest include at least:

- schema/protocol version;
- decision system and evaluation mode;
- eligibility and exclusion rules;
- enrollment start boundary and optional predeclared end boundary;
- required evidence/freshness/PIT conditions;
- ticket universe and decision classes in scope;
- protocol authoring/version metadata.

Changing any eligibility rule creates a new protocol identity. Existing membership is never rewritten under a new rule.

### Cohort membership

`cohortId` identifies a prospective cohort. Each membership assertion binds:

- `cohortId`;
- `enrollmentProtocolId` + digest;
- canonical race identity;
- immutable decision record identity + digest;
- enrollment timestamp and deterministic enrollment reason;
- inclusion/exclusion state and explicit reason.

Enrollment is append-only. A later outcome, payout, closing odds, or model result must never decide whether an earlier row belongs to the cohort.

### Analysis snapshot

`analysisSnapshotId` freezes the membership set used for one analysis. It binds the ordered membership identities/digests plus the cutoff/as-of boundary. A new cutoff or membership set creates a new snapshot; an old snapshot is never mutated.

### Evaluation protocol

`evaluationProtocolId` identifies the scoring contract frozen before the evaluated forward evidence is interpreted. It includes at least:

- metrics and formulas;
- stake/return/refund/void semantics;
- BUY-time versus closing-odds basis;
- selected-race versus common-cohort denominator semantics;
- normal and max-hit-removed reporting rules;
- probability metrics where applicable (logloss, Brier, calibration);
- grouping dimensions and minimum-sample/reporting rules;
- missing/unresolved exclusion semantics;
- benchmark decision system(s);
- code/schema version and canonical digest.

Changing a formula, denominator, odds basis, exclusion rule, or benchmark creates a new protocol identity.

## Required stage separation

Every vault artifact has exactly one evidence stage:

- `HISTORICAL`
- `VALIDATION`
- `UNTOUCHED_HOLDOUT`
- `SHADOW_FORWARD`
- `FUTURE_ONLY`

Stage is immutable for an artifact. The same observation cannot be silently relabeled from historical/validation into holdout or forward evidence. Aggregation across stages is prohibited unless a separately versioned reporting artifact presents each stage independently; it must not emit a pooled ROI or pooled promotion statistic.

## Comparison contracts

The vault must keep these distinct:

1. **selected-race performance** — each decision system is evaluated on the races it independently selected;
2. **common-cohort comparison** — systems are compared only on a predeclared shared cohort with a common denominator.

Neither may substitute for the other. Reports must label the comparison mode explicitly.

BUY-time odds and closing odds are separate evidence bases and may not share a metric field without an explicit odds-basis dimension. Probability quality, market edge, ticket selection, and realized ROI are separate metric families.

Refunded, void, cancelled, unresolved, or non-final outcomes follow the frozen Outcome Learning Ledger semantics and cannot be converted to ordinary losses for convenience.

## Append-only and idempotency contract

Every vault record has a stable identity and canonical digest.

- unseen identity + valid payload -> `APPEND`;
- same identity + same canonical digest -> `IDEMPOTENT_NOOP`;
- same identity + different digest -> `CONFLICT` and fail closed;
- invalid or unresolved-required input -> `REJECTED_INVALID` or `EXCLUDED_UNRESOLVED`, never an inferred score.

Re-running an evaluator must reproduce the same snapshot/protocol/result digest from the same immutable inputs. A corrected result is a new version with explicit supersession lineage; it does not overwrite prior evidence.

## Frozen result artifact

A scored evaluation result binds at least:

- result identity/version;
- evidence stage;
- `analysisSnapshotId` + digest;
- `evaluationProtocolId` + digest;
- decision-system/version tuple;
- metric family and comparison mode;
- odds basis;
- included/excluded counts by explicit reason;
- aggregate metric values;
- source decision/outcome digest set or a deterministic manifest digest;
- evaluator/code version;
- canonical result digest.

Private raw odds and private filesystem paths are never embedded in Git governance artifacts. Evidence references are sanitized identities/digests only.

## Fail-closed exclusions

The following cannot be scored as forward evidence:

- ambiguous decision or ticket identity;
- unresolved settlement/finality/refund semantics;
- cohort membership decided after seeing the outcome;
- protocol created or materially changed after seeing the evaluated outcomes;
- future/same-race leakage that violates the applicable PIT contract;
- missing required version identity;
- a historical row relabeled as prospective forward evidence;
- a Current BUY or production mutation presented as research evaluation.

Excluded rows remain countable as exclusions so coverage cannot improve by silently dropping hard cases.

## Storage and executor boundary

Do not create a second generic atomic-write subsystem for this vault. Research governance already provides append-only atomic publication and read-back primitives. Vault executors must reuse those primitives with a vault-specific validator/classifier and a research-only write allowlist. Mutable executor artifacts, if any, are not vault authority.

Initial implementation and tests use fixtures/temp storage only. No live collector, Current BUY, LINE, `app_settings`, production database, public publisher, or automated betting connection is authorized by this contract.

## Definition of done for implementation

Before the Forward Evaluation Vault may be described as implemented:

1. versioned TypeScript types and strict JSON schemas exist for enrollment protocol, membership, analysis snapshot, evaluation protocol, and result;
2. validators reject unknown fields, invalid identities, stage mixing, unresolved required lineage, and unsafe numeric/timestamp values;
3. canonical digests and append/idempotency conflict classifiers are tested;
4. fixture tests prove outcome-based enrollment cannot alter frozen membership;
5. fixture tests prove historical/validation/holdout/forward stages cannot be pooled accidentally;
6. fixture tests prove selected-race and common-cohort denominators remain distinct;
7. temp-store tests reuse existing atomic write/read-back infrastructure and prove same-ID/different-content fails closed;
8. production-isolation checks remain green.

Until all eight hold, this document is a design contract only and no readiness or promotion claim is permitted.

## Promotion boundary

Forward evidence is evaluation memory, not production authority. Even strong forward results require the existing Experiment -> reproducible evaluation -> Discovery/Rejection -> accepted Transfer Experiment -> human-approved research promotion -> separate production gate path. This vault cannot activate N2, alter Current BUY, send LINE, publish public data, or place a bet.
