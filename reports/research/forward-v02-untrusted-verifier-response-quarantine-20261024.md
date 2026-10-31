# Forward v0.2 untrusted verifier response quarantine (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only synthetic response metadata; no real verifier, external trust root, authenticated time, complete source finality, approved scoring protocol, production connection or private evidence.

## Question and authority

Can a future verifier's *caller-provided* response be structurally compared with the v0.2 proof-request metadata without allowing a self-reported `VERIFIED` flag to become independent authority?

Start-of-run: canonical main `2342494f6581c167a5648681ca7374b26d6659d4`, one open research PR #2286, previous HEAD `854df3bb49cd1a967941eadbd58a3989dc370bbd`, official prior CI #40092600117 SUCCESS. Read latest-main research learning and knowledge retention contracts, relevant forward v0.2 LEARN records, the sole dataset inventory Experiment and Discovery, empty Rejection registry, and recent merged Forward Vault PR #2285. The dataset inventory does not establish prospective independent proof.

Learning gate: `fingerprintKey=research-k3.forward-vault.v02-untrusted-verifier-response-binding`; `attemptSignature=pr2286-v297-deny-only-synthetic-response-proof-reference-and-revision-digest-binding`; `environmentKey=github-connector/research-pr-node24-ci`; `materialStateKey=forwardV02IndependentProofRequest.0.1-untrusted/pr2286-854df3bb/no-response-quarantine`. Result: `PROCEED_DISTINCT_SYNTHETIC_CONTRACT / REUSE_VERIFIED_GUARDRAILS`. Reused the proof-request array-helper guardrail, terminal proof-reference fixture guardrail and prior GitHub readback guardrail.

## Implementation

- `src/research/governance/forwardV02UntrustedVerifierResponse.ts`: new denial-only response assessment calls the existing strict proof-request builder, then checks an exact allowlisted caller response with own data descriptors and a dense ordered array of claimed revision content digests. Rejects unknown fields, injected authority flags, mismatched policy/cohort/receipt/proof/terminal refs, revision omissions/reordering, accessor arrays and malformed claimed statuses. Does not invoke input getters or array iterators.
- `src/research/governance/forwardV02UntrustedVerifierResponse.test.ts`: nine synthetic tests, including the critical negative vector where both caller statuses say `VERIFIED` but the result still has literal `independentAuthorityVerified=false` and `scoringAuthorized=false`. All output is frozen and contains blockers only, never raw values or claimed trust credentials.
- This is **not** an independent verifier API implementation. The response does not include a cryptographically authenticated commitment to the complete request/revision chain, and this structural comparison must never be upgraded to scoring admission. Future reviewed design needs independently provisioned trust roots, signed full-request binding, trusted clocks, source-specific revocation/finality, complete correction history and protocol approval.

Implementation `dc029cb2fd94c40fcf3afbed4cec46bfcf47ea60`, tests `e708fc20d6205a33606bca7c693cacfedcc3d2b9`, typecheck fix `42f9eb2d07535627711c4fcfe0f1066550f81740`, append-only Learning `60bbc3fe52d260354fce9e7991f56c2e83c9b9e8`.

## CI and failure separation

Initial official CI #40096380340: research-governance Typecheck failed with `TS2702` in the new test because `typeof Array.prototype[Symbol.iterator]` was used in a type assertion. This was a **test-source TypeScript compile failure**, not a failed evidence verifier. Typecheck process exited 1; research-governance job failed, post-job checkout/cache cleanup completed, hosted runner had no observed platform failure. Replaced it with `typeof original` after capturing the method as a value. Recorded `LEARN-forward-v02-verifier-response-iterator-type-index-20261024` (digest `bcd7cabbefdbec791dbc50c496e12382ff8757847b4d639896ba47466a3e5d02`). Latest-HEAD CI must be read from GitHub Actions before any PASS claim.

Protected N2 was not activated. Historical natural Feature Rollup #40003695814: research payload `NO_CHANGE`, refresh and post-job steps success, job conclusion FAILURE; no proven platform root cause. Historical Daily Readiness #39834565537: `DAILY_PLAN_MISSING`, process exit 3, job FAILURE, cleanup completed. Another natural rollup #40074049575 had no allocated jobs at inspection. No private readiness counts inferred.

## Falsification and next gate

Falsify this structural contract if any invalid/unbound claimed response is admitted as metadata-consistent, any input accessor is executed, any revision is silently skipped, or any path reports independently verified/scorable. Next safe work: design a complete request commitment and independent offline signature/clock/revocation test vectors with synthetic keys only, then keep all authorization paths blocked pending human protocol approval. No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard or protected N2 changes.
