# Forward Vault v0.2 — metadata-only ticket/disposition projection ambiguity (2026-10-31 JST)

**Authority: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Synthetic offline research only. No K-data, raw T-5 odds, actual ticket, account, private path, secret, production connection, scoring, or protected N2 execution was used.

## Question and bounded finding

Can a structurally consistent `forward-v02-independent-proof-request.0.1-untrusted` request distinguish two exact tickets or a normal settled return from a refund? **No.** The request intentionally projects only allowlisted freeze/witness, source/anchor, terminal revision and claimed correction-chain metadata. Exact ticket identity, selection, disposition and independently attested terminal return kind are absent. Its `metadataConsistent=true` must not be promoted to proof that those fields were bound.

A new synthetic regression holds the proof refs, claimed revision and other request metadata fixed while changing **(a)** both caller-declared ticket-key fields consistently to a distinct synthetic ticket and **(b)** `SETTLED/evaluable=true` to `REFUNDED/evaluable=false`. Both alternative caller envelopes pass the current *structural* preflight and produce a request deeply equal to the baseline. The test exercises both the normal and strict Node ingress. Every outcome remains `independentAuthorityVerified=false`, `scoringAuthorized=false`, with the same three unverified/approval blockers.

This is an **intentional lossy metadata projection**, not a cryptographic SHA-256 collision, a discovered verifier bypass, or evidence that any real ticket was misclassified. It is a concrete negative capability demonstration: an eventual independently provisioned verifier must never infer exact-ticket or return-kind identity solely from this 0.1 request or a caller-recomputed transcript digest.

## Evidence and reproducibility

- Canonical main at authority gate: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Draft research PR #2286; separate LINE-owned PR #2287 has no overlapping changed file. No merge or production promotion.
- Executable synthetic regression: `src/research/governance/forwardV02IndependentProofRequest.test.ts`, test `metadata-only proof request has no injective ticket identity or disposition binding`, commit `1793ac46063bda95b1b9cd49739b5e763b0ac484`.
- Request builder: `src/research/governance/forwardV02IndependentProofRequest.ts` (`0.1-untrusted`); envelope structural preflight: `src/research/governance/forwardV02AuthorityMetadata.ts`; independent trust preflight: `src/research/governance/forwardV02TrustPolicyPreflight.ts`.
- Related prior audits: `reports/research/forward-v02-pr2286-proof-request-ticket-return-kind-capability-gap-20261031.md` and `reports/research/forward-v02-pr2286-ticket-return-kind-negative-specification-20261031.md`. The latter's eight future-verifier cases remain **specification-only**, not executed.
- Existing `LEARN-forward-v02-partial-verifier-request-binding-20261024` already warns that a full request correlation digest is not source attestation. Reuse `LEARN-forward-v02-terminal-return-kind-fixture-parity-20261031` for synchronized synthetic fixtures. Historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` are dataset inventory lineage, not source rights/settlement authority; no relevant Rejection record identified.
- CI verification: **pending at report creation**. A green earlier HEAD is not evidence that this new regression executed. Check the exact report HEAD after commit; if red, inspect full job logs before classification.

## Future design boundary and falsifiers

A future, separately reviewed, versioned source-proof contract would have to bind exact bet type, selection, decision identity, terminal revision, source-authenticated return kind, complete corrections and revocation/finality. It must be provisioned independently of the caller, with privacy-preserving evidence handling; do **not** add raw ticket, odds or settlement amounts to this public metadata request. A future verifier would be unsound if it treated the existing projection as an injective ticket/return proof. A distinct versioned contract with independent issuer proof could legitimately resolve the ambiguity; this regression intentionally applies only to the 0.1 metadata-only handoff.

No source-specific K rights grant, authenticated correction/finality proof, independently frozen cohort, approved protocol, verified ROI or readiness count is established. `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE` and Draft remain mandatory.

## Learning gate

- `fingerprintKey=research-k3.forward-v02.metadata-only-proof-request-ticket-disposition-projection-alias`
- `attemptSignature=pr2286-v493-synthetic-ticket-identity-and-refund-projection-collision-regression`
- `environmentKey=github-connector-pinned-research-pr/github-actions-node24-synthetic`
- `materialStateKey=forwardV02IndependentProofRequest.0.1-untrusted/settlement-allowlist-excludes-ticket-key-disposition@6b99997f`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Classification: `REUSED_LEARNING / NO_NEW_LEARNING`. This is an explicit regression of a previously documented intentional authority boundary, not a newly proven production defect. No duplicate `LEARN-*` is created.

**Next safe action:** verify exact-HEAD CI, then seek independently attributable K issuer/usage rights and exact-ticket source proof/correction/finality evidence. Do not activate protected N2, change Current BUY, LINE, public publishing, automated betting, production behavior/settings, or Owner Dashboard.
