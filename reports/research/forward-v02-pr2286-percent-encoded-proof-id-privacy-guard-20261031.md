# Forward Vault v0.2 — percent-encoded local-path tokens in untrusted proof-request identifiers

- Date: 2026-10-31 UTC/JST
- Evidence stage: **SYNTHETIC_OFFLINE_ENGINEERING**; no live source access or protected N2 execution
- Authority: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
- PR: #2286; canonical main pinned to `2342494f6581c167a5648681ca7374b26d6659d4`
- Scope: metadata-only untrusted proof-request export, not an independent verifier

## Question, hypothesis and learning gate

Can percent-encoded filesystem-path tokens pass a raw-only local-path lexical check when an identifier is later decoded by a consumer? Hypothesis: a caller-controlled free-form identifier can carry an encoded absolute POSIX, Windows drive, UNC or file-URL token while the old raw regex sees no path delimiter. This is a **source-level synthetic admission risk**, not an observed private-data disclosure.

Normalized gate:
- `fingerprintKey=research-k3.forward-v02.proof-request-percent-encoded-local-path-id`
- `attemptSignature=pr2286-v499-bounded-four-layer-percent-decoding-before-proof-id-export`
- `environmentKey=github-contents-api/github-actions-ubuntu-node24-synthetic`
- `materialStateKey=forwardV02IndependentProofRequest.ts@889e37d4/raw-only-path-token-check`
- `PROCEED_DISTINCT / REUSE_GUARDRAIL`: no unchanged matching encoded-path attempt; reused `LEARN-forward-v02-proof-request-embedded-local-path-id-20261031` and `LEARN-github-generated-regex-literal-escape-drift-20261031`. The existing raw-token guard remains in place. No Experiment/Discovery/Rejection grants issuer authority; main's dataset-coverage Experiment/Discovery are unrelated to this privacy boundary.

## Bounded implementation and synthetic protocol

The builder checks the raw identifier, then up to four `decodeURIComponent` layers, rejecting a detected local-path token, malformed percent-encoded input or residual percent octets at the depth bound. This intentionally fails closed for opaque deeply encoded values; it does not claim to be a universal redactor. The blocker is always `PRIVATE_PATH_METADATA`, with `request=null`, `independentAuthorityVerified=false`, `scoringAuthorized=false`. Neither blockers nor exported requests echo the synthetic path tokens on denial.

The single regression test covers ten synthetic negative mutations (cohort, witness issuer/receipt/anchor, settlement source, terminal and nonterminal correction IDs, bounded/deeper encoding and malformed encoded text) through both ordinary and strict Node ingress. Four benign encoded HTTPS/namespace/opaque-percent controls are checked through both paths. Existing raw-path and authority-negative tests remain. All identifiers are synthetic placeholders; no private path, secret, raw T-5 odds or ticket data is used.

- Source: `src/research/governance/forwardV02IndependentProofRequest.ts`
- Test: `src/research/governance/forwardV02IndependentProofRequest.test.ts`
- Code commit: `e2d9a2705158d4054f24024e6d62c343bdee9781`
- Test commit: `be7339b0a1e3e2f80702554800b3ce10539338c2`
- Exact test-HEAD CI: [GitHub Actions #41208394897](https://github.com/m-shogo/boat-pon/actions/runs/41208394897); final conclusion must be verified independently from Actions, not inferred from this report.

## Falsification, limits and next safe step

The admission finding would be falsified if the previous raw-only check already rejected the listed percent-encoded synthetic path forms. The remediation fails if any negative case yields a non-null request, if a benign control is rejected, or if a caller-supplied identifier becomes scoring authority. The guard covers bounded percent-decoding only; it does not inspect arbitrary obfuscation, prove confidentiality of other transports, authenticate K-source rights or settlement/finality, bind exact-ticket return kind, freeze a prospective cohort, or approve scoring.

Keep #2286 Draft and non-mergeable by governance policy. Obtain independently attributable K issuer/usage-rights, correction/finality and ticket-level return-kind evidence before any verifier promotion. Do not activate protected N2 or modify Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard or private evidence.
