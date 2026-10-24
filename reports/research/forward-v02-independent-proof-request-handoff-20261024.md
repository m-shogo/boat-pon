# Forward v0.2 independent proof request boundary (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, synthetic metadata. No real independent evidence, verifier, trusted anchor, approved scoring protocol, readiness count, private raw odds or production connection.

## Research question and authority gate

Can the unapproved v0.2 candidate prepare a narrowly allowlisted, immutable **request** for a future independent verifier, while preventing caller-supplied trust policy and proof-shaped fields from becoming an authority decision?

Canonical main at implementation: `2342494f6581c167a5648681ca7374b26d6659d4`. One open research PR #2286; baseline HEAD `2676dcbceb6ba8feb8e9d6f0f105bab7f0b5a241`. Latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md` read. Existing v0.2 independent authority contract, current untrusted metadata/trust-policy preflights, relevant Learning fingerprints and Experiment/Discovery registry records read; no relevant Rejection record on main. Recent merged research PRs inspected. The dataset inventory Discovery does not establish independent forward settlement authority.

## Concrete implementation

- `src/research/governance/forwardV02IndependentProofRequest.ts`: `buildForwardV02IndependentProofRequest` accepts untrusted envelope, policy and proof refs only after the existing strict trust-policy metadata preflight. On failure it emits no request.
- On structural consistency, it copies only proof **references and claims** into an immutable, detached, versioned request: frozen-cohort/protocol/membership digests, claimed witness receipt/clock/anchor, claimed settlement source/anchor, terminal revision reference, and **every** claimed revision's identity/digest/predecessor/sequence/time/finality.
- The request does **not** carry caller policy anchor arrays, public key digests, raw payouts/odds, stake, ticket selection, secrets or private paths. Trust roots must be independently provisioned by a future reviewed verifier. No callback or caller-provided verification verdict can authorize anything.
- Every return path preserves literal `independentAuthorityVerified: false` and `scoringAuthorized: false`. Even `REVIEWED` self-reported policy and matching proof digests remain `UNVERIFIED_WITNESS / UNVERIFIED_SOURCE / UNAPPROVED_PROTOCOL`.
- `src/research/governance/forwardV02IndependentProofRequest.test.ts`: eight synthetic regressions cover minimal allowlisting, immutable snapshot/readback, full correction chain, stale terminal proof ref, revoked/missing policy, injected trusted/raw fields, and matching self-signed metadata. Reuse the terminal-proof-reference fixture guardrail.

Implementation commits: `705ee3235a2bd7318722712cded2b4a60a9fbf35` and `c98f2d8e45daaf08c111970c1961f9317bf668af`. Official CI is the acceptance authority; do not treat a queued/in-progress run as success. Latest-HEAD CI is `https://github.com/m-shogo/boat-pon/actions/runs/40084683828` (initially queued/in progress when this report was drafted).

## What this does not prove

No independently authenticated signature, trusted time/inclusion proof, revocation freshness, externally governed trust root, complete source revision history, source-specific terminality, frozen eligible universe, payout semantics, or approved v0.2 denominator/formula is established. This is a safe **handoff shape**, not a verifier API implementation or authorization to score/merge. Falsification: any malformed/unbound input yielding a request, any request carrying private raw evidence/trust key material, a dropped predecessor revision, or any path returning verified/scorable would invalidate this boundary.

## Workflow diagnosis (no protected activation)

- N2 Feature Rollup #40003695814, full job log (228 lines): research payload `NO_CHANGE`, refresh step and post-job steps SUCCESS, but overall job FAILURE. No definitive runner/platform root cause in the visible log; a job-level failure is not evidence of a research-payload failure.
- N2 Daily Readiness #39834565537, full job log (202 lines): `DAILY_PLAN_MISSING`, process exit 3 in readiness step, workflow failure; post-job cleanup completed.
- N2 Feature Rollup #40074049575 remains PENDING with no jobs allocated at inspection. Do not infer any readiness count or start a diagnostic run.
- Previous PR CI #40080644535: full verify log identifies two `UNBOUND_PROOF_REFS` fixture failures, not a runner error; corrected in existing `fc1115f9d1d4`. Subsequent official CI #40080906153 succeeded. No N2 re-run was requested or performed.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.v02-independent-proof-request-handoff-boundary`
- `attemptSignature`: `pr2286-v294-allowlisted-immutable-untrusted-proof-request-eight-synthetic-fixtures`
- `environmentKey`: `github-connector/research-pr-node24-ci`
- `materialStateKey`: `forwardV02TrustPolicyPreflight.0.1-untrusted/pr2286-2676dcbc/no-explicit-proof-request-handoff`
- Gate: `PROCEED_DISTINCT_HANDOFF / REUSE_VERIFIED_GUARDRAILS`.
- Reused: `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024`, `LEARN-forward-v02-settlement-revision-anchor-window-20261024`, `LEARN-forward-v02-cross-envelope-authority-id-replay-20261024`, `LEARN-github-write-readback-20260918`.
- Classification at report creation: `REUSED_LEARNING / NO_NEW_LEARNING`. This is a routine safe extension of prior known deny-only constraints, not independent proof or a new root-cause class. No duplicate `LEARN-*` created.

**Next safe action:** after official CI, review a separately provisioned non-production trust-root/source-finality model and deterministic proof-verification test vectors. Keep scoring admission and all production behavior disconnected. No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, or protected N2 changes.
