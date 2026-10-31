# Forward Vault v0.2 independent authority evidence contract (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only, metadata-only **design and verification specification**, not an attestation, implemented trust verifier, approved protocol, real-data evaluation, or scoring authorization. No private raw odds, private values, source paths, readiness counts, production behavior, or protected N2 execution are used.

## Question and decision

What would turn the existing v0.2 candidate's internally consistent, caller-supplied Decision/Outcome/Manifest digests into **independently verifiable** prospective cohort enrollment and **authoritative terminal** settlement evidence?

**Decision: no existing caller-provided digest, `EXACT` flag, timestamp, or `sourceAuthority` string can satisfy either requirement.** Define two separate immutable witness/evidence chains, an explicit source-trust policy, and a deterministic revision-selection protocol *before* adding an authorization branch. Until then, the v0.2 candidate remains unapproved and all existing `scoringAuthorized: false` branches are mandatory.

## Existing authorities and bounded evidence

- Canonical main inspected: `2342494f6581c167a5648681ca7374b26d6659d4`. Existing research PR: #2286; prior code HEAD `a55f4ce3359fb30878bf7226f7b1d5bb0b1e7b67`.
- Latest verified official PR CI at contract drafting: Actions #40047949603, `verify` and `research-governance` SUCCESS; 4,272 PASS / 2 SKIP / 0 FAIL. **This is verification of prior synthetic gates, not this contract or independent evidence.**
- Canonical contracts: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `docs/architecture/forward-evaluation-vault.md`, `docs/architecture/outcome-learning-ledger-contract.md`.
- Existing candidate gates: `forwardEvaluationProtocolV02Candidate.ts`, `forwardV02ReferenceReconciliation.ts`, `forwardV02OutcomeLinkPreflight.ts`, `forwardV02LinkedBuyRaceParity.ts`, `forwardScoringAdmission.ts`. These check shape/content/linked race-set parity; **none authenticate a third-party witness or independently prove finality**.
- Related existing findings: `reports/research/forward-v02-outcome-link-preflight-gate-20261024.md` and `reports/research/forward-v02-local-outcome-race-parity-gate-20261024.md`. Prior Experiment `EXP-dataset-expand-701398c2` and Discovery `DISC-dataset-coverage-701398c2` concern dataset inventory, **not** independent forward enrollment/settlement; no relevant Rejection record was found on canonical main. Do not infer evaluation readiness from that Discovery.

## A. Prospective freeze authority: required evidence contract

An independently checkable enrollment attestation must bind, in a versioned canonical payload:

1. **Identity:** evaluation stage, cohort ID, enrollment protocol ID + digest, membership snapshot ID + digest, decision-system set, ticket universe, frozen inclusion/exclusion rule version and explicit expected membership/coverage universe. A digest of only *observed* included decisions is not a proof of the eligible universe.
2. **Chronology:** the authoritative witness's receipt/commit time and immutable evidence identifier must strictly precede the **earliest** included decision time; protocol creation and membership/enrollment boundaries must independently precede their respective decisions. The witness time cannot be inferred from an object `createdAt` or a Git commit produced after outcomes.
3. **Independent trust:** an allowlisted external witness or append-only log with verifiable signature/inclusion proof, trusted public verification material, canonical encoding/version, and a documented clock/ordering model. Caller-selected issuer strings, digests, unsigned JSON, or a self-signed assertion do not establish independence.
4. **Completeness:** every predeclared eligible race/decision has an immutable membership inclusion or explicit exclusion/missingness entry; counts derive from verifiable records, not supplied summary counts. Corrections append a new protocol/snapshot lineage and never rewrite a predecision freeze.
5. **Binding:** witness receipt commits to the exact frozen protocol/membership digest; each evaluated Runtime Decision Ledger identity/digest links to that committed universe and stage. A post-result Source Manifest is a **separate** evidence artifact, never retroactive enrollment proof.

Required outcomes: `FROZEN_AND_EXTERNALLY_ATTESTED`, `UNVERIFIED_WITNESS`, `AFTER_DECISION`, `MISSING_MEMBERSHIP`, `CONFLICT`, or `UNSUPPORTED_STAGE`. Only a future independently implemented verifier may emit the first status; the current repository cannot.

## B. Terminal settlement and supersession authority: required evidence contract

An independent result attestation must bind each decision record to the exact race, ticket type, selection, stake, settlement identity, source evidence digest(s), source revision and observed/authoritative finalization times.

1. **Trust boundary:** verify the external source's authenticity and revision authority independently of the caller-supplied Outcome Ledger, Source Manifest, and `reconciliation: EXACT` flag. An outcome record's `finality: FINAL` is a claim, not an attestation.
2. **Append-only revisions:** retain *every* known source revision as `(revisionId, contentDigest, predecessorRevisionDigest, sourceSequenceOrOrdering, observedAt, sourceFinality)`. Same revision identity with different content is `CONFLICT`. A later correction supersedes, never overwrites, the prior record.
3. **Terminal selection:** select exactly one terminal authoritative revision using a **preapproved source-specific ordering and finality rule**. Missing predecessors, forks, ties without source order, revoked terminality, contradictory terminal revisions, or unproven completeness are `UNRESOLVED_FINALITY` / `CONFLICT`, not a guessed latest result.
4. **Semantic reconciliation:** independently establish `EXACT` decision/ticket identity, payout, refund, void/cancelled status, evaluability, and monetary units. Preserve excluded/refunded/unresolved rows with explicit reason. Never convert non-evaluable refunds into ROI losses.
5. **Correction impact:** if a later authoritative revision changes a previously evaluated outcome, retain the original evaluation and append a superseding evaluation artifact with the new source-manifest/protocol lineage; do not silently mutate historic results.

Required outcomes: `EXACT_TERMINAL_ATTESTED`, `UNVERIFIED_SOURCE`, `UNRESOLVED_IDENTITY`, `UNRESOLVED_FINALITY`, `UNRESOLVED_REFUND_OR_INVALIDATION`, `INCOMPLETE_REVISION_CHAIN`, `CONFLICT`. No current synthetic helper is permitted to emit the first status as verified authority.

## C. Trust-boundary architecture and future verifier API

```text
independent predecision witness + immutable membership receipt
      -> signature/inclusion/clock verification -> frozen cohort authority
independent settlement source + append-only revision chain
      -> source authentication + terminal revision selection -> EXACT authority
canonical decision/outcome/manifest content preflights (existing, deny-only)
      -> independent authority conjunction + approved frozen v0.2 protocol
      -> future separately reviewed evaluation admission (NOT implemented)
```

The verifier must accept **metadata and authenticated proof references only**, not raw private evidence or secrets. Trust anchors are reviewed/versioned configuration, never a caller-supplied `trusted: true` field; source credentials and raw evidence remain outside Git. It must distinguish `STRUCTURALLY_VALID` from `INDEPENDENTLY_VERIFIED`, record immutable proof identifiers and verifier version, and fail closed on missing trust configuration, clock ambiguity, signature/inclusion failure, stale revocation information or incomplete revision history.

An evidence envelope is *not* independently verified merely because it contains issuer, timestamp, digest, signature-shaped string or all required fields. An implementation with only synthetic metadata can at most return `STRUCTURALLY_VALID_UNATTESTED` and **`scoringAuthorized: false`**. The existing v0.1 Outcome Ledger has no canonical revision/supersession chain, so do not reinterpret its immutable digest as terminal correction history.

## D. Required isolated negative fixtures before implementation acceptance

| Fixture | Expected deny condition |
| --- | --- |
| Post-outcome manifest claims an earlier `createdAt` | `UNVERIFIED_WITNESS` / `AFTER_DECISION` |
| Caller computes both enrollment digest and matching witness-like metadata | `UNVERIFIED_WITNESS` |
| External witness receipt is at or after first decision | `AFTER_DECISION` |
| Valid digest of a membership subset omits an eligible decision | `MISSING_MEMBERSHIP` |
| Historical/validation evidence relabeled as untouched holdout | `UNSUPPORTED_STAGE` |
| Two settlement revisions share an identity but differ in bytes | `CONFLICT` |
| Revision chain has a missing predecessor or a fork | `INCOMPLETE_REVISION_CHAIN` / `CONFLICT` |
| Newer observed event lacks authenticated terminality | `UNRESOLVED_FINALITY` |
| Two terminal revisions have no trusted total order | `CONFLICT` |
| Same race but different ticket/selection or decision ID | `UNRESOLVED_IDENTITY` |
| Refund/void is labeled evaluable by a caller | `UNRESOLVED_REFUND_OR_INVALIDATION` |
| Trust anchor absent, revoked, stale or self-selected by caller | `UNVERIFIED_SOURCE` |
| Structurally perfect synthetic evidence with no independent proof | **always** `scoringAuthorized: false` |

Positive synthetic tests may establish only deterministic parsing, linkage and fail-closed classification. Independent source authentication requires separately provisioned, non-production proof material and reviewed verification logic; **no real authority is available or asserted in this run**.

## E. Acceptance and next safe engineering slice

Before changing the scoring gate: (1) select and review an independently verifiable predecision witness/clock trust model; (2) select and review a settlement source with explicit correction and terminality semantics; (3) version the attestation envelope and strict JSON schema, including source-specific finality policy; (4) add synthetic negative tests above and an offline, explicitly untrusted fixture proving self-attestation cannot pass; (5) separately validate actual independent proof without private-value publication; (6) approve the full v0.2 formula, common-cohort denominator, refund/void/max-hit exclusion policy and source-manifest contract. No readiness counts or real ROI may be claimed before that evidence exists.

**Current decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This document closes the *specification gap*, not the evidence/implementation gap. Do not merge PR #2286 merely because ordinary CI passes.

## Learning gate and classification

- `fingerprintKey`: `research-k3.forward-vault.v02-independent-freeze-and-terminal-authority-contract`
- `attemptSignature`: `pr2286-v286-metadata-only-independent-witness-and-revision-selection-spec`
- `environmentKey`: `github-connector/canonical-main+research-pr+official-ci`
- `materialStateKey`: `forward-v02-candidate/pr2286-a55f4ce/local-outcome-parity-no-external-attestation`
- Gate: `PROCEED_DISTINCT_SPECIFICATION / REUSE_EXISTING_FAIL_CLOSED_GUARDRAILS`; no equivalent unchanged failed attempt identified.
- Reused: `LEARN-forward-v02-unmatched-decision-coverage-20261024`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-actions-self-hosted-ten-minute-red-jobs-20261008`, `LEARN-github-write-readback-20260918`.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. This is a new governance specification derived from existing known blockers, not a newly discovered failure or a verified independent success; no new `LEARN-*` record is warranted.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, or protected N2 workflow was accessed or modified.
