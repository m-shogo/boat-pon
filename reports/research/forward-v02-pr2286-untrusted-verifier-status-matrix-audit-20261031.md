# Forward Vault v0.2 — untrusted verifier status matrix audit (2026-10-31 JST)

Status: **research-only, synthetic, no independent authority, DO_NOT_MERGE_CANDIDATE**.

## Question and threat model

Could a caller-controlled verifier response reporting `VERIFIED`, `REJECTED`, or `UNKNOWN` for witness and settlement accidentally be treated as an independently authenticated verdict when its metadata correlation digest matches the request? In particular, a future consumer must not confuse `responseMetadataConsistent=true` with a positive issuer or settlement finding.

## Method / fixed boundary

At PR #2286 commit `9718f94dff5ce3d71ebcb90d0fec1c0bdc965bb6`, add a single deterministic regression to `src/research/governance/forwardV02UntrustedVerifierResponse.test.ts` covering all **3 × 3 = 9** caller-claimed status pairs on both the legacy and strict Node ingress. Use only the existing in-memory synthetic fixture, a matching structural request digest, and the existing response shape. Do not use real K, private T-5 odds, secrets, production data, protected N2, or a live verifier. The regression asserts request and response metadata consistency can remain true while `independentAuthorityVerified=false`, `scoringAuthorized=false`, and all four untrusted/unverified/unapproved blockers remain present.

This explicitly pins the meaning of *structural consistency*, not the correctness of a `REJECTED` or `UNKNOWN` verdict. The digest binds the **request transcript**, not the independent provenance or truth of the response status. The test also covers the fact that a status-label change does not mutate the original request-binding digest.

## Observed / evidence stage

Source inspection shows `assessForwardV02UntrustedVerifierResponse` permits the three claimed labels but always returns literal false authority flags, including when all metadata fields match. The new regression covers this interpretation across both ingress paths. At report creation, official HEAD CI for this new commit was **not yet confirmed**; only the previous HEAD `7bd981d9e0c76512c4907f802880ed22e8d47059` had verified green CI [#41191372811](https://github.com/m-shogo/boat-pon/actions/runs/41191372811). Treat the new test as unverified until an exact-HEAD run executes it.

## Prior learning and scope

Reuse `LEARN-forward-v02-partial-verifier-request-binding-20261024` (complete request transcript still untrusted) and `LEARN-forward-v02-response-split-snapshot-trap-repair-20261025` (whole-response snapshot). This is a **distinct, bounded status-label matrix** rather than a retry of either failure mechanism. Existing `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` concern historical dataset coverage, not this verifier semantics contract; no matching Rejection registry entry was found on canonical main.

Normalized pre-attempt learning gate:
- `fingerprintKey=research-k3.forward-v02.untrusted-verifier-claimed-status-matrix-nonauthority`
- `attemptSignature=pr2286-v496-nine-claimed-status-pairs-normal-and-strict-ingress-synthetic-regression`
- `environmentKey=github-connector-pinned-pr-source/github-actions-node24-synthetic`
- `materialStateKey=forwardV02UntrustedVerifierResponse.0.2-untrusted@7bd981d9/status-labels-structural-only`
- `gate=PROCEED_DISTINCT / REUSE_GUARDRAIL`

## Falsification and outstanding blockers

A future regression that grants either authority flag, drops blockers for any claimed status pair, or treats `responseMetadataConsistent` as a positive verifier verdict would falsify this guardrail. A future independent verifier must require separately provisioned trust roots, signed and authenticated issuer/witness/finality and correction evidence, ticket-level return-kind proof, and an approved frozen scoring protocol. No such evidence is supplied here. K issuer/usage rights remain unverified. No readiness counts or scoring eligibility are inferred.

ProductionConnection=false. No change to Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 or private evidence. Keep PR #2286 Draft / `ENGINEERING_REQUIRED`.
