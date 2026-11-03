# Forward Vault v0.2 — exact-ticket return-kind negative fixture specification (2026-10-31 JST)

**Authority: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, synthetic offline *negative specification*. This is not an executed independent verifier, a positive attestation, an authenticated K source, or permission to score or merge.

## Question, mechanism and finding

The unmerged v0.2 candidate requires independently attributable exact ticket type, selection, terminal revision and return kind. The existing `forward-v02-independent-proof-request.0.1-untrusted` exports only claimed source/anchor/revision metadata and no authenticated ticket-level classifier. The Outcome Ledger 0.1 `SETTLED/REFUNDED/VOID` vocabulary cannot by itself distinguish ordinary from special payout. A future verifier or bridge could therefore silently treat caller labels, payout amount or race-wide settlement as evidence.

This slice freezes **eight distinct proposed denial vectors** in a new append-only companion catalog, with an executable **static catalog-integrity test** that checks all IDs, mutations, independent-fixture preconditions, denial classes, rationales, source references, custody rules, literal false authorization flags and closed field sets. The test does **not** execute those eight verifier vectors; it only detects unauthorized drift in their specification.

- Catalog: `reports/research/forward-v02-ticket-return-kind-negative-vectors-20261031.json`
- Static guard: `src/research/governance/forwardV02TicketReturnKindNegativeCatalog.test.ts`
- Catalog commit: `2000cb57cbcc2fcc46c714ca75f4a74af535784f`
- Static test commit: `68a556ff99b9e8d540467a185f1d38b2e80b936f`
- Earlier independent-verifier 18-vector catalog is preserved unchanged; this is a separate return-kind supplement, not a rewrite of historical evidence.

## Eight proposed future negative cases

| ID | Failure to distinguish | Proposed denial |
| --- | --- | --- |
| R01 | Positive payout with no independently authenticated return kind | `UNRESOLVED_RETURN_KIND` |
| R02 | Source-authenticated special payout relabeled ordinary | `CONFLICT` |
| R03 | Exacta source proof reused for trifecta in the same race | `UNRESOLVED_IDENTITY` |
| R04 | Exact ticket proof reused for a different selection | `UNRESOLVED_IDENTITY` |
| R05 | Earlier ordinary return superseded by a terminal special-payout correction | `CONFLICT` |
| R06 | Race-wide void status substituted for bet-type establishment | `UNRESOLVED_IDENTITY` |
| R07 | Refund mapped to zero-payout loss | `UNRESOLVED_REFUND_OR_INVALIDATION` |
| R08 | Caller-recomputed digest treated as source attestation | `UNVERIFIED_SOURCE` |

R05 is a **contradiction** against an independently authenticated later terminal correction, not unresolved finality; a separate missing-terminal-proof case would use unresolved finality. These denial names are **proposed fixture classifications**, not claims that a current verifier emits them. The catalog has `status=SPECIFICATION_ONLY_NOT_EXECUTABLE`, `independentAuthorityVerified=false`, `scoringAuthorized=false`, and `productionConnection=false`. A future positive control requires separately provisioned test source authority, complete source correction/finality semantics, exact ticket binding, and explicit human review. It must never derive its trust root from the caller request.

## Authority and reproducibility

- Canonical main at authority gate: `2342494f6581c167a5648681ca7374b26d6659d4`. PR #2286 Draft; PR #2287 separately owned LINE work. No merge attempted.
- Latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md` read. Historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` are dataset inventory, not K rights or terminal settlement authority; no relevant Rejection record identified.
- Recent merged research PR #2285 (Vault core) and #2284 (Vault contract) read; neither authorizes a future verifier, ROI scoring or production.
- Reused `LEARN-forward-v02-terminal-return-kind-fixture-parity-20261031` (keep synthetic fixtures synchronized), `LEARN-forward-v02-candidate-return-population-special-payout-20261031` (exclude/count special payout), `LEARN-forward-v02-partial-verifier-request-binding-20261024` (caller digest is not attestation), and `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024` (terminal revision binding).
- Normalized `fingerprintKey=research-k3.forward-v02.ticket-return-kind-future-verifier-negative-spec-coverage`; `attemptSignature=pr2286-v490-eight-static-return-kind-negative-vectors-and-tamper-guard`; `environmentKey=github-actions-node24-research-only-static-catalog`; `materialStateKey=proof-request-0.1-untrusted+outcome-ledger-0.1+candidate-return-kind-required@368b45d8`. Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. No equivalent unchanged failure was retried.
- The exact-HEAD official CI result must be checked after the report commit. An earlier green CI is not proof of this new test.

## Falsifiers and limits

A future implementation is unsafe if any of R01–R08 can become verified/scorable without source-authenticated exact-ticket proof, or if the fixture catalog can be silently changed to approve caller-supplied claims. The static test checks only the latter specification drift, not the former runtime verifier behavior. No positive K evidence, rights grant, source-correction completeness, independently frozen cohort, accepted protocol, valid ROI denominator or readiness count is established.

No protected N2 activation, private T-5 odds, raw ticket/account values, secret, private path, Current BUY, LINE, public publishing, automated betting, production behavior/settings or Owner Dashboard change was made.

**Next safe action:** check exact-HEAD CI and correct any genuine test issue from full job logs; then obtain independently attributable issuer/usage rights and source-specific ticket return-kind/correction/finality evidence before any verifier or bridge is considered. Remain Draft / `DO_NOT_MERGE_CANDIDATE`.

**Learning:** `REUSED_LEARNING / NO_NEW_LEARNING`; no novel failure or non-obvious verified success yet warrants a new `LEARN-*` record.
