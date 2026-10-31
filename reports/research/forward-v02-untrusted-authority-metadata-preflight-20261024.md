# Forward Vault v0.2 — untrusted authority metadata preflight (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only synthetic metadata verification. No independent source authentication, scoring authorization, production connection, raw odds, private evidence, private paths, protected N2 activation, or real ROI is involved.

## Question, hypothesis, and bounded evidence

Can a metadata-only parser reject contradictory prospective-enrollment and terminal-settlement *claims* without mistakenly upgrading a caller-generated receipt, signature-shaped digest, `EXACT`-like flag, or `FINAL` string into independently verified authority?

Hypothesis: a strict, deterministic deny-only preflight can detect structural contradictions and preserve the external-trust boundary. The hypothesis would be falsified by any synthetic input that yields `scoringAuthorized: true` or `independentAuthorityVerified: true`, or by a contradictory receipt/revision fixture classified as internally consistent.

Canonical main at start: `2342494f6581c167a5648681ca7374b26d6659d4`. Existing PR: #2286, research branch. Previous contract: `reports/research/forward-v02-independent-authority-evidence-contract-20261024.md`. This slice extends the prior v0.2 *specification*, not the v0.1 vault, Current BUY, or an approved evaluation protocol.

Relevant authorities: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `docs/architecture/forward-evaluation-vault.md`, `docs/architecture/outcome-learning-ledger-contract.md`, and `src/research/governance/forwardScoringAdmission.ts`. The main Experiment `EXP-dataset-expand-701398c2` and Discovery `DISC-dataset-coverage-701398c2` concern dataset inventory, not independent witness or terminal settlement. No canonical-main Rejection in this scope was identified.

## Implementation and synthetic verification

- `src/research/governance/forwardV02AuthorityMetadata.ts`: new isolated `assessForwardV02AuthorityMetadata(unknown)` helper. No I/O, secrets, imported production modules, scoring, or mutable authority state.
- `src/research/governance/forwardV02AuthorityMetadata.test.ts`: 19 synthetic tests, executed locally using Node 22 experimental type stripping with **19/19 PASS** before the GitHub commit. Official CI is separately authoritative for integration.
- Strict own-data shape checks reject unknown keys, getters, sparse/extra array properties, duplicate membership, `toJSON`, invalid timestamps, and unsupported stage relabeling. Indexed loops also prevent a mutated Array.prototype[Symbol.iterator] from bypassing membership coverage.
- Prospective metadata checks compare receipt and decision chronology at submillisecond precision, receipt commitment to caller-supplied protocol/membership digests, and membership coverage *within the caller-supplied universe*.
- Settlement metadata checks reject decision/ticket identity mismatch, refund/void/cancelled evaluability mismatch, duplicate revision identities, missing predecessor links, ambiguous revision ordering, and a latest nonterminal/revoked revision.
- A perfectly self-consistent synthetic receipt and terminal chain yields only `STRUCTURALLY_VALID_UNATTESTED`; `independentAuthorityVerified: false` and `scoringAuthorized: false` are literal return types, including on this path.

**Crucial limit:** neither the purported membership universe nor its receipt time is independently established. The `signatureDigest`, `issuerId`, `trustAnchorId`, `sourceFinality`, and revision order are untrusted caller metadata. This helper does **not** check signatures, witness inclusion proofs, source-specific revocation or clock trust, authoritative revision completeness, payout/identity evidence, or protocol approval. `metadataConsistent` is **not** enrollment readiness or evidence admission. No trusted success status is implemented.

## Safety and integration decision

This is a deliberately standalone preflight, **not connected** to `forwardScoringAdmission` or any evaluator. It must not be interpreted as the separately reviewed independent proof verifier demanded by the v286 contract. No scoring/admission path is introduced.

Still blocked: reviewed independent predecision witness/trust model; canonical frozen eligible-universe proof; independently authenticated terminal settlement with full corrections and source ordering; approved v0.2 formula, refunds, max-hit, common-cohort denominator and exclusions; independently verified final evidence. No readiness counts or real performance results are claimed.

## Learning and repeat gate

- `fingerprintKey`: `research-k3.forward-vault.v02-untrusted-authority-metadata-boundary`
- `attemptSignature`: `pr2286-v287-strict-untrusted-witness-and-revision-metadata-deny-only-19-synthetic-fixtures`
- `environmentKey`: `github-connector/research-pr-node24-ci+node22-offline-fixtures`
- `materialStateKey`: `forward-v02-candidate/pr2286-b21a8f4c/authority-spec-without-metadata-preflight`
- Gate: `PROCEED_DISTINCT_SYNTHETIC_IMPLEMENTATION / REUSE_VERIFIED_GUARDRAILS`. The prior v286 step was a specification, not an unchanged failed implementation attempt.
- Reused: `LEARN-forward-v02-unmatched-decision-coverage-20261024`, `LEARN-outcome-ledger-array-iterator-admission-bypass-20261021`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-github-write-readback-20260918`, and prior runner-failure classification.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. The implementation exercises already documented deny-first rules; routine green tests alone do not establish a new non-obvious reusable success or new root-cause class. No new LEARN record is warranted.

**Next safe action:** independently review a versioned trust-anchor and witness/source-verification API, add a strict envelope schema and negative fixtures, and keep the scoring gate closed until an actual independent proof and protocol approval exist. Do not merge this PR based solely on CI.
