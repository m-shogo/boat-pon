# Forward Vault v0.2 — synthetic Ed25519 mathematics boundary (v299)

Date: 2026-10-25 JST
Authority: research-only, UNTRUSTED, no production or scoring authority
Review: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**

## Question and prior authority

Can an offline synthetic Ed25519 check distinguish a signature matching the
complete Forward v0.2 request transcript from a wrong key, tampered signature,
or modified request, **without** promoting caller-supplied key material to an
independent trust root?

Start-of-run main: `2342494f6581c167a5648681ca7374b26d6659d4`.
Open research PR: #2286. Read the latest-main Research Learning Loop and
Knowledge Retention Contract, relevant Forward v0.2 LEARN records, Experiment
and Discovery registries, and recent merged research PRs. Existing
`LEARN-forward-v02-partial-verifier-request-binding-20261024` supplies the
complete transcript-binding guardrail; the existing iterator/type and mutable
array guardrails are reused. No equivalent prior signature-math probe was
found on canonical main. The sole current PR remains unmerged.

Normalized pre-attempt identity:

- fingerprintKey: `research-k3.forward-vault.v02-offline-ed25519-caller-key-math-boundary`
- attemptSignature: `pr2286-v299-offline-ephemeral-ed25519-math-claim-binding-negative-tests`
- environmentKey: `github-connector/github-actions-node24-typescript6.0.3`
- materialStateKey: `forwardV02UntrustedVerifierResponse.0.2-untrusted/pr2286-3e3e0e0d/no-signature-math-probe`
- gate: `PROCEED_DISTINCT_SYNTHETIC_MATH_ONLY / REUSE_VERIFIED_GUARDRAILS`

## Concrete change and falsification

Added `src/research/governance/forwardV02SyntheticEd25519Claim.ts`
(commit `02ae4c48614b05f444d3af8d7747168282f2876c`).
It accepts only a strict, metadata-only caller claim, uses Node's Ed25519
verification against the domain-separated SHA-256 complete-request digest,
and explicitly returns `independentAuthorityVerified=false` and
`scoringAuthorized=false` on **all** paths. It never reads external keys,
files, private paths, odds or credentials; it performs no network calls.

Added `src/research/governance/forwardV02SyntheticEd25519Claim.test.ts`
(commits `2bb737cea41e653f2000dc390a13fa9235d781c6` and
`50d4094777b00fabd7b0373e8820255880f3723c`).
Six synthetic tests generate ephemeral in-process keys and check:

1. valid signature mathematics still denies independent authority and scoring;
2. wrong key or changed signature is rejected;
3. changed request metadata cannot reuse an earlier signature;
4. unsupported algorithm, malformed encoding and injected authority flags fail closed;
5. revoked caller policy and getter-bearing claims fail closed;
6. a caller can re-sign a changed request with its own key, producing valid
   signature mathematics **without** independent authority or scoring.

These tests do **not** establish an independently provisioned signer, trusted
clock, source-finality proof, complete correction history, revocation evidence,
approved evaluation formula or permission to score. A caller can generate a
fresh key and re-sign a changed request. Mathematical validity with a
caller-supplied key must never be presented as authentic external evidence.

Official latest-code CI: GitHub Actions
`40105212448` (PR HEAD `2bb737cea41e653f2000dc390a13fa9235d781c6`);
verify was still in progress when this report was authored, and
research-governance had succeeded. Do not infer a final green result from
this interim observation. The final report/PR status must use the actual
latest HEAD and completed checks.

## Independent N2 audit (no protected workflow activation)

Previously red Feature Rollup run `40003695814`: the research payload
reported `NO_CHANGE`, all visible steps including post-job cleanup
succeeded, yet workflow conclusion was failure. Runner/platform root cause
is **unclassified**; do not relabel it a failed research experiment.

Previously red Daily Readiness run `39834565537`: the private readiness
payload reported `DAILY_PLAN_MISSING`, the process exited 3, and the
workflow failed; checkout post-job completed. The process failure is
distinguishable from a runner failure. Do not invent readiness counts.

Natural Feature Rollup run `40074049575` was cancelled; successor
`40095318225` was pending on read. No N2 dispatch, rerun or settings change.

## Governance and next safe step

No Current BUY, LINE, public publishing, automated betting, production
behavior/settings, Owner Dashboard, private T-5 values or paths were touched.
The work is a synthetic cryptographic primitive check, **not** an
independent verifier or promotion gate. The external trust-root provisioning,
signature provenance, clock, revocation, settlement source finality and
human-reviewed evaluation protocol remain blocking dependencies.

Learning classification: `REUSED_LEARNING / NO_NEW_LEARNING` pending
official test verification. No new non-obvious failure or reusable root-cause
lesson is asserted merely because a new contract test is green. If official
CI reveals a meaningful distinct failure, classify and record it through an
append-only LEARN before claiming retained learning.
