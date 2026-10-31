# Forward Vault v0.2 — ticket/disposition alias through claimed verifier response (2026-10-31 JST)

**Authority: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only synthetic offline regression. No independent issuer attestation, K archive, real ticket, raw T-5 odds, secrets, private paths, protected N2, Current BUY, LINE, public publishing, automated betting, production settings, or Owner Dashboard touched. No scoring authority.

## Question and bounded observation

The v493 regression established that two structurally consistent caller envelopes can project to an identical `forward-v02-independent-proof-request.0.1-untrusted` despite different exact ticket identities or `SETTLED` versus `REFUNDED` dispositions. **Does a matching caller-declared `VERIFIED` response and its SHA-256 request-binding transcript restore the missing ticket/return-kind distinction? No.**

A new synthetic integration regression fixes all request-projected metadata and a self-computed response digest, then separately changes (1) both declared ticket keys to a different synthetic ticket and (2) the caller's disposition from `SETTLED/evaluable=true` to `REFUNDED/evaluable=false`. The independently unchanged metadata projection yields the same request and exact transcript digest in both cases. Both normal and strict Node verifier-response quarantine paths may report `requestMetadataConsistent=true` and `responseMetadataConsistent=true` because the *claim* is structurally correlated. **Both must still return `independentAuthorityVerified=false`, `scoringAuthorized=false`, and the untrusted/unverified/unapproved blockers.**

This is an intentional **non-injective projection**, not a SHA-256 collision, authenticated verifier bypass, observed refund misclassification, or production vulnerability. `responseMetadataConsistent=true` is only a correlation statement about untrusted fields. It does not attest exact ticket identity, ticket selection, terminal return kind, corrections, source completeness, or rights.

## Reproducibility and evidence

- Canonical main at pre-write authority gate: `2342494f6581c167a5648681ca7374b26d6659d4`. Research PR #2286 remains Draft/unmerged; PR #2287 separately owns LINE work.
- New executable synthetic regression: `src/research/governance/forwardV02UntrustedVerifierResponse.test.ts`, test `metadata-only verifier response correlation cannot distinguish exact ticket or refund disposition`, commit `00bd881717ac6b0c74e6ad911ba9fc10aac1a979`.
- Boundaries under test: `forwardV02IndependentProofRequest.ts` and `forwardV02UntrustedVerifierResponse.ts`; the latter's response schema is `0.2-untrusted`, not an independently provisioned verifier.
- Prior v493 ticket/disposition projection report: `reports/research/forward-v02-pr2286-proof-request-ticket-disposition-projection-alias-20261031.md`.
- Latest pre-report CI for test-bearing HEAD: [Actions #41186718015](https://github.com/m-shogo/boat-pon/actions/runs/41186718015), **in progress at report authoring**. No PASS claim is made here; final run result must be checked separately.

## Learning and authority gate

Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; reused `LEARN-forward-v02-synthetic-reference-never-authority-20261025`, `LEARN-forward-v02-terminal-return-kind-fixture-parity-20261031`, and `LEARN-forward-v02-negative-catalog-first-denial-precedence-20261026`. Reviewed recent merged research PRs #2284/#2285 and historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`. Those historical coverage records are not prospective source attestation. No new applicable Rejection lineage established.

- `fingerprintKey=research-k3.forward-v02.untrusted-response-ticket-disposition-projection-alias`
- `attemptSignature=pr2286-v494-synthetic-response-binding-alias-normal-and-strict-ingress`
- `environmentKey=github-connector-pinned-pr-source/github-actions-node24-synthetic`
- `materialStateKey=forwardV02IndependentProofRequest.0.1-untrusted+UntrustedVerifierResponse.0.2-untrusted@00bd8817/omits-ticket-disposition`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Classification: `REUSED_LEARNING / NO_NEW_LEARNING`. No duplicate LEARN for an already understood intentional boundary.

## Decision and next safe action

Keep `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`. The future verifier must obtain independently provisioned K-specific rights, exact-ticket identity and return-kind attestation, authenticated inclusive correction/finality proof, source trust/clock/revocation evidence, frozen prospective cohort and approved protocol before any scoring path can be considered. Reuse the existing issuer clarification packet; do not invent a positive proof or activate protected N2. The new test protects the existing **deny-only** semantics while those dependencies remain unresolved.
