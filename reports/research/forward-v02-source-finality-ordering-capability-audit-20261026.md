# Forward Vault v0.2 — source-specific finality and ordering capability audit (2026-10-26)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only, metadata-only capability audit, **not** a selected external provider, independently authenticated correction history, executed verifier, accepted source trust policy, positive attestation, or scoring authorization. No protected N2 execution, production/Current BUY/LINE/public connection, private raw odds, secrets, source paths or readiness counts.

## Precise question

Which independently supplied *source-specific* facts are necessary before a future verifier can decide that one settlement revision is terminal, ordered and complete, rather than merely the last revision supplied by an untrusted caller?

Authority at review: canonical `main` `2342494f6581c167a5648681ca7374b26d6659d4`, open research PR #2286 (preceding head `3642bfa545494ba8903b4475b4f4a40e5255c23a`). Read latest-main research learning/retention contracts, Forward Vault architecture, merged #2283–#2285, the independent-authority evidence contract, the 18-vector negative fixture specification and static catalog test, `forwardV02AuthorityMetadata.ts`, `forwardV02TrustPolicyPreflight.ts`, `forwardV02IndependentProofRequest.ts`, the relevant terminal-reference, per-revision anchor-window, catalog-precedence and semantic-drift LEARN records, and `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`. Rejection registry contains no substantive relevant record. Dataset inventory is **not** prospective enrollment or terminality proof.

## What the existing code actually proves

`assessForwardV02AuthorityMetadata` validates a *caller-provided* linear revision list: `sequence === index + 1`, predecessor content-digest linkage, strictly increasing caller `observedAt`, no duplicate revision ID/digest, and a last `sourceFinality === FINAL` claim. A matching list returns **STRUCTURALLY_VALID_UNATTESTED**, with literal `independentAuthorityVerified=false` and `scoringAuthorized=false`. `assessForwardV02TrustPolicyPreflight` checks a caller-provided anchor's interval against **every** revision, but does not authenticate the anchor or timestamp. `buildForwardV02IndependentProofRequest` retains the entire claimed chain for a *future* independent verifier. None establishes that the list is exhaustive, that its order is source-authoritative, or that FINAL remains terminal after later corrections.

A source can have two different complete histories that yield the same caller-visible prefix. Therefore **no function of that prefix alone can prove that a later correction does not exist**. A content digest, local polling time, caller sequence, signature-shaped string, latest API response, or local absence of another record cannot solve this information gap. This is a source capability/evidence dependency, not a missing sort comparator.

## Capability decision matrix (no provider selected)

| Candidate source capability | What it could support *if independently authenticated* | What it cannot prove by itself | Decision |
| --- | --- | --- | --- |
| A. Authenticated append-only revision event stream with source-controlled monotonic order, immutable event IDs, complete range proofs, authenticated finalized checkpoint/watermark and explicit post-final correction semantics | Bounded source order, predecessor completeness **through a specified checkpoint**, and terminality under a reviewed source-specific finality rule | Absolute forever-finality unless the source explicitly guarantees it; exact ticket settlement without separate identity/payout proof | **CONDITIONALLY_ELIGIBLE_FOR_FUTURE_REVIEW**, not verified |
| B. Signed latest-state snapshots with no complete revision-history/range proof | Authenticity of a particular observed snapshot if signature/issuer/clock checks succeed | Missing predecessor, fork, skipped correction, total revision order, or no later terminal correction | **INSUFFICIENT_FOR_COMPLETE_CORRECTION_PROOF** |
| C. Pollable latest-result API or caller-supplied `FINAL/EXACT` and `observedAt` | At most an observation / structural claim | Independent source identity, historical completeness, source order, authenticated terminality | **UNVERIFIED_SOURCE / UNRESOLVED_FINALITY** |
| D. Authenticated revision events but no independently verifiable source checkpoint or finality rule | Authenticated events that were actually obtained | Completeness of omitted events, tie resolution, terminal revision selection | **UNRESOLVED_FINALITY** |

These are *capability classes*, not claims that a specific boat-race settlement provider offers them. No synthetic or real provider is approved here. A trusted key without an independently justified ordering/completeness model is insufficient.

## Minimum separately reviewed source-policy contract

A future policy must be **independently provisioned**, versioned and digest-bound outside the caller request, and must specify:

1. **Source namespace and authenticity:** approved source/issuer ID, canonical signed payload format, algorithm/key IDs, validity and revocation semantics, and how verifier obtains/validates immutable source records. Caller `sourceId`, `claimedAnchorId`, `REVIEWED` or signature-shaped metadata cannot choose these.
2. **Source ordering:** authenticated event/revision identity, monotonic source order (or a documented deterministic partial-order resolution), predecessor/supersession linkage, fork/tie/equivocation behavior, and a rule forbidding local `observedAt` or caller `sequence` as the tie-break.
3. **Completeness bound:** independently authenticated checkpoint identifying an inclusive source event range, proof that all relevant events through that bound are included, and an explicit treatment of absent/missing events. A hash of only received revisions is insufficient.
4. **Finality semantics:** exact meaning of `FINAL`, the authenticated checkpoint/watermark at which it becomes eligible, whether final results can be corrected, whether a correction revokes or supersedes earlier finality, and how an evaluation appends a superseding artifact without rewriting the original.
5. **Time and revocation:** clock source/ordering assurance, freshness of source checkpoint and revocation snapshot, key rollover across predecessor revisions, and the source-specific treatment of delayed publication/backfill.
6. **Exact settlement binding:** race + decision + ticket type/selection + stake + payout units + refund/void/cancellation + evaluability, each tied to authenticated source revision identity. Race-only equality or a terminal status alone is insufficient.
7. **Protocol pinning:** approved evaluation protocol/version and predeclared cutoff must be fixed independently of caller proof requests. Later checkpoint availability does not retroactively authorize a changed cohort or formula.

A verifier cannot interpret a local sequence `1,2,3` as source sequence `1,2,3` without independently authenticated order. Nor can it infer that the latest source observation is a completeness watermark. If the source does not publish or authenticate a required capability, the gate stays **ENGINEERING_REQUIRED**; do not invent an adapter that returns success.

## Deterministic counterexamples and required future negative tests

| Counterexample | Same visible caller evidence | Hidden/source-authoritative difference | Required fail-closed outcome |
| --- | --- | --- | --- |
| Omitted late correction | `A -> B(FINAL)`, matching hashes | Source contains `C` superseding B before the claimed checkpoint | `INCOMPLETE_REVISION_CHAIN` / `UNRESOLVED_FINALITY` until complete authenticated range |
| Backdated observation | `A -> B(FINAL)`, increasing `observedAt` | Source order puts B before A or has no trusted order | `CONFLICT` / `UNRESOLVED_FINALITY`; never sort by local clock |
| Split terminal fork | Two FINAL descendants with valid-looking IDs | Source has no approved supersession/tie-break rule | `CONFLICT`; no arbitrary winner |
| Authenticated snapshot without event-range proof | Signed `B(FINAL)` | Earlier correction predecessor or another source revision is omitted | `UNRESOLVED_FINALITY`; signature alone insufficient |
| Rollover across chain | Terminal B signed under active key | Predecessor A was signed under revoked/out-of-window key | `UNVERIFIED_SOURCE` for entire claimed chain |
| Finality revoked after checkpoint | B was terminal at checkpoint k | Authenticated later correction C at k+1 changes disposition/refund | Superseding evaluation artifact only after independently verified new terminality; no mutation of historical score |
| Identity or refund mismatch | FINAL race/result matches | Exact ticket/decision/refund evidence does not | `UNRESOLVED_IDENTITY` or `UNRESOLVED_REFUND_OR_INVALIDATION` |

These are **future verifier falsification cases**, not newly executed cryptographic tests. The existing 18-vector catalog already covers S02–S09 and must remain specification-only. Do not duplicate its IDs or claim additional executed test counts. The distinctive missing proof is **authenticated range completeness and source-defined finality across checkpoints**, not another caller-side metadata field.

## Gate, decision, and next concrete dependency

- `fingerprintKey=research-k3.forward-vault.v02-source-finality-ordering-capability-audit`
- `attemptSignature=pr2286-v349-compare-source-capability-classes-and-derive-checkpoint-completeness-requirements`
- `environmentKey=github-connector/research-pr-contract-audit`
- `materialStateKey=forward-v02-pr2286-v348-untrusted-revision-chain-and-spec-only-negative-catalog-no-independent-source-policy`
- Learning gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reused `LEARN-forward-v02-settlement-revision-anchor-window-20261024`, `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024`, `LEARN-forward-v02-negative-catalog-first-denial-precedence-20261026`, `LEARN-forward-v02-negative-catalog-case-semantics-drift-20261026`. No unchanged failed method retried.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. This audit resolves which *capabilities* would be necessary, not a new failure/root cause or a verified successful implementation. No filler LEARN.
- **Next:** identify an actual candidate settlement source's documented revision IDs, authenticated ordering, correction completeness/checkpoint and finality semantics. If the source cannot prove a complete range, retain the blocker. Only then draft a *separately provisioned, synthetic-only* policy/schema and execute denial vectors; do not create a verified-positive fixture or scoring branch before independent review.

**Merge remains blocked** by independent witness trust/clock/revocation, prospective eligible-universe proof, source-specific authenticated correction completeness and terminality, exact ticket/refund settlement, and an approved v0.2 evaluation protocol. This report is not an authorization to merge, activate N2, connect Current BUY/LINE, publish, bet, or change production/Owner Dashboard.
