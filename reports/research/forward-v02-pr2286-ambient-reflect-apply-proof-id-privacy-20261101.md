# Forward Vault v0.2 — pin proof-request regex dispatch against ambient Reflect.apply

- Date: 2026-11-01 JST
- Evidence stage: **SYNTHETIC_OFFLINE_ENGINEERING**
- Authority: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
- Scope: PR #2286 research-only metadata request; no private raw odds, secrets, real filesystem paths, N2 activation, or production connection
- Canonical main at pre-write gate: `2342494f6581c167a5648681ca7374b26d6659d4`; separate PR #2287 remains outside this change

## Question, method, and prior evidence

Could a caller-realm replacement of `Reflect.apply` suppress the local-path privacy guard even after the request builder captured native `RegExp.prototype.exec`? Source inspection at PR HEAD `b11843dafc4d83669eea6582855cef03595af124` showed `matchesFixedRegex` still dispatching through ambient `Reflect.apply`. A caller-controlled hook could return `null` for the two fixed privacy regexes, potentially exporting synthetic local-path-looking identifiers.

This reuses the independently documented method failure `LEARN-shadow-evidence-ambient-reflect-apply-dispatch-admission-20261030` and `LEARN-shadow-evidence-ambient-regexp-test-exec-admission-20261029`; the same root-cause guardrail is applied to a distinct untrusted proof-request output boundary. Existing path-token Learning records (`LEARN-forward-v02-proof-request-embedded-local-path-id-20261031` and `LEARN-forward-v02-proof-request-percent-encoded-local-path-id-20261031`) remain applicable. The canonical Experiment `EXP-dataset-expand-701398c2` and Discovery `DISC-dataset-coverage-701398c2` concern historical inventory, not verifier authority; no new Experiment, Discovery, or Rejection is inferred.

## Change and falsification protocol

Capture `Reflect.apply` at module initialization alongside native `RegExp.prototype.exec` and invoke the fixed regex through that captured dispatcher. Add one synthetic regression that reversibly hooks ambient `Reflect.apply` to forge negative privacy-pattern results, tests ordinary and strict Node ingress against a raw POSIX-like token and a percent-encoded equivalent, and confirms an encoded benign HTTPS identifier remains structurally admissible but unverified.

Falsifier: either path token yields a non-null request; either authority or scoring flag becomes true; the benign control is rejected; or the privacy matcher dispatches through the ambient replacement. This does not address hooks installed *before module initialization*, unrelated secret formats, downstream decoding policies, or independent K issuer/rights, settlement finality, ticket-level return kind, frozen cohort or scoring approval.

## Evidence and CI

- Fix: `commit/9b8dd872d7769fe7616e1ba137aecc89604a0da9`
- Regression: `commit/bbb840e9829018078359fa7a5c506e506203d252`
- Code: `src/research/governance/forwardV02IndependentProofRequest.ts`
- Test: `src/research/governance/forwardV02IndependentProofRequest.test.ts`
- GitHub Actions run: https://github.com/m-shogo/boat-pon/actions/runs/41217870601 — **in progress at report creation**; do not treat as verified success until exact-HEAD jobs and logs complete.

## Learning gate

- classification: `REUSED_LEARNING` (pending regression confirmation); no new LEARN claimed
- fingerprintKey: `research-k3.forward-v02.proof-request-ambient-reflect-apply-dispatch-bypass`
- attemptSignature: `pr2286-v501-pin-dispatch-and-ambient-hook-regression`
- environmentKey: `github-contents-api/github-actions-ubuntu-node24-synthetic`
- materialStateKey: `forwardV02IndependentProofRequest.ts@b11843da/ambient-reflect-apply-dispatch`
- action: `REUSE_GUARDRAIL / PROCEED_DISTINCT`
- productionConnection: `false`

Keep PR #2286 Draft. If CI is red, inspect complete job logs and separate research payload, process exit, workflow, post-job and runner layers before classifying. Next external dependency remains an independently attributable K issuer/rights grant and authenticated ticket-level correction/finality/return-kind evidence. No readiness count or promotion authority is inferred.
