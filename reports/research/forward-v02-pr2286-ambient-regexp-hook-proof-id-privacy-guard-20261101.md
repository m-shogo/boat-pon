# Forward Vault v0.2 — ambient RegExp hooks and proof-request identifier privacy

- Date: 2026-11-01 JST
- Evidence stage: **SYNTHETIC_OFFLINE_ENGINEERING**; no K source access, private raw values, or protected N2 execution
- Authority: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
- PR: #2286; canonical main pinned to `2342494f6581c167a5648681ca7374b26d6659d4`
- Scope: metadata-only, caller-controlled untrusted proof-request identifier export; **not** independent proof verification

## Research question, mechanism and gate

Question: can a mutable ambient `RegExp.prototype.test` or `RegExp.prototype.exec` suppress the raw or percent-encoded path-token check, allowing synthetic path-like identifiers to be projected? The prior guard called `.test` on fixed regexes; native `test` itself dispatches through mutable `exec`. A malicious test/exec hook could therefore return a false negative even when the lexical pattern matches. This is a synthetic source-level admission risk, **not** an observed real private-path disclosure.

Normalized learning identity:
- `fingerprintKey=research-k3.forward-v02.proof-request-ambient-regexp-hook-privacy-bypass`
- `attemptSignature=pr2286-v500-capture-native-regexp-exec-for-path-and-percent-guards`
- `environmentKey=github-connector/github-actions-ubuntu-node24-synthetic`
- `materialStateKey=forwardV02IndependentProofRequest.ts@4f8db575/ambient-test-dispatch`
- Gate: `REUSE_GUARDRAIL / PROCEED_DISTINCT`. Existing `LEARN-shadow-evidence-ambient-regexp-test-exec-admission-20261029` already documents the identical mutable-regex-dispatch root cause and verified native-exec remedy. Also reused `LEARN-forward-v02-proof-request-embedded-local-path-id-20261031`, `LEARN-forward-v02-proof-request-percent-encoded-local-path-id-20261031` and `LEARN-github-generated-regex-literal-escape-drift-20261031`. No duplicate LEARN is warranted unless verification establishes a distinct failure class.

The canonical main Experiment `EXP-dataset-expand-701398c2` and Discovery `DISC-dataset-coverage-701398c2` concern dataset inventory, not this privacy control; main has no Rejection records. Recent merged PR #2285 supplies Forward Evaluation Vault infrastructure, not K issuer or settlement authority.

## Bounded implementation and falsifiable synthetic protocol

The builder now captures the native `RegExp.prototype.exec` at module initialization and invokes it directly with `Reflect.apply` for both fixed patterns. This avoids mutable `.test` and the `test -> exec` delegation. It does not guarantee security if intrinsics were compromised before module evaluation, if `Reflect.apply` is compromised, or if an unrecognized path encoding is used.

A new synthetic regression test temporarily replaces `RegExp.prototype.test` and, separately, `RegExp.prototype.exec` with hooks that selectively suppress the two privacy patterns. For each hook it checks raw and percent-encoded synthetic absolute path identifiers through ordinary and strict Node ingress, with a benign encoded HTTPS control. Expected result: no privacy-pattern hook invocation; generic `PRIVATE_PATH_METADATA`, null request, false independent authority and scoring flags, and no identifier reflection. A regression or incompatible benign control would falsify the guardrail.

- Implementation: `src/research/governance/forwardV02IndependentProofRequest.ts`
- Regression: `src/research/governance/forwardV02IndependentProofRequest.test.ts`
- Code commit: `a66cace6f0059bbe9361bd89570b8166a3611c41`
- Test commit: `e07675f40f52e8d983c6a3067de6c5c9ad09fa43`
- CI status at report creation: [{"id":41213222843,"status":"in_progress","conclusion":null}]

## Interpretation and remaining blockers

This is a narrow synthetic privacy guardrail, not a universal sanitizer, issuer signature verification, source finality proof, ticket-level return-kind binding, frozen forward cohort, or scoring authorization. K-data issuer/usage rights, authenticated correction/finality history, independent witness/clock/revocation material, ticket-specific return/refund evidence and approved evaluation protocol remain missing. Keep PR #2286 Draft and unmerged; do not alter Current BUY, LINE, Owner Dashboard, public publishing, automated betting, production settings, protected N2, or private raw evidence.

Classification pending exact-HEAD CI: **REUSED_LEARNING** (existing mutable-RegExp root-cause guardrail), with no new LEARN until a distinct root cause is established.
