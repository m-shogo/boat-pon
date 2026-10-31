# Forward Vault v0.2 strict Node ingress coverage audit (2026-10-26)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**. Read-only, source-level research audit; no independent authority, scoring, production connection or protected N2 activation.

## Evidence boundary

- Canonical `main`: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Open research PR: #2286, audited head `3094a0dd07b87d044344cdcc62f74d85eff791ca` (v343).
- Official CI at audited head: [#40234329694](https://github.com/m-shogo/boat-pon/actions/runs/40234329694), `verify=SUCCESS`, `research-governance=SUCCESS`; the job step summaries report successful test, build, typecheck, isolation checks and post-job cleanup. This audit did **not** run a new local test or protected workflow.
- Authority: latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; PR source under `src/research/governance/forwardV02*.ts`; relevant prior Learning IDs below.
- The formal Experiment/Discovery/Rejection registries on latest main have no v0.2-specific record; existing dataset-foundation `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` do **not** constitute v0.2 prospective enrollment, independent evidence or promotion authority. No relevant Rejection record was found in the main rejection directory. No dataset counts are used as readiness evidence.

## Assessment and builder entry points

The audited PR exposes the following **13 opt-in strict Node ingress entry points**. Every corresponding legacy assessment/builder remains separately exported and unchanged. The strict path rejects encountered root/nested/revoked Proxies via `node:util` `types.isProxy` before caller-controlled Proxy traps; it rejects accessor properties without invoking getters, then delegates detached metadata to the legacy evaluator. This is a source/CI coverage observation, not proof of arbitrary cross-writer atomicity.

| Legacy research entry point | Opt-in strict entry point | Implementation |
| --- | --- | --- |
| `assessForwardV02AuthorityMetadata` | `assessForwardV02AuthorityMetadataStrictNodeIngress` | `forwardV02AuthorityMetadata.ts` |
| `assessForwardV02AuthorityBatch` | `assessForwardV02AuthorityBatchStrictNodeIngress` | `forwardV02AuthorityBatch.ts` |
| `assessForwardV02ReferenceReconciliation` | `assessForwardV02ReferenceReconciliationStrictNodeIngress` | `forwardV02ReferenceReconciliation.ts` |
| `assessForwardV02UntrustedVerifierResponse` | `assessForwardV02UntrustedVerifierResponseStrictNodeIngress` | `forwardV02UntrustedVerifierResponse.ts` |
| `assessForwardV02TrustPolicyPreflight` | `assessForwardV02TrustPolicyPreflightStrictNodeIngress` | `forwardV02TrustPolicyPreflight.ts` |
| `buildForwardV02IndependentProofRequest` | `buildForwardV02IndependentProofRequestStrictNodeIngress` | `forwardV02IndependentProofRequest.ts` |
| `assessForwardV02SyntheticEd25519Claim` | `assessForwardV02SyntheticEd25519ClaimStrictNodeIngress` | `forwardV02SyntheticEd25519ClaimStrictNodeIngress.ts` |
| `assessForwardV02SyntheticClaimedAnchorBinding` | `assessForwardV02SyntheticClaimedAnchorBindingStrictNodeIngress` | `forwardV02SyntheticStrictNodeIngress.ts` |
| `assessForwardV02SyntheticReferenceAnchorConflict` | `assessForwardV02SyntheticReferenceAnchorConflictStrictNodeIngress` | `forwardV02SyntheticStrictNodeIngress.ts` |
| `assessForwardV02OutcomeLinkPreflight` | `assessForwardV02OutcomeLinkPreflightStrictNodeIngress` | `forwardV02OutcomeAndParityStrictNodeIngress.ts` |
| `assessForwardV02LinkedBuyRaceParity` | `assessForwardV02LinkedBuyRaceParityStrictNodeIngress` | `forwardV02OutcomeAndParityStrictNodeIngress.ts` |
| `assessForwardV02LocalOutcomeRaceParity` | `assessForwardV02LocalOutcomeRaceParityStrictNodeIngress` | `forwardV02OutcomeAndParityStrictNodeIngress.ts` |
| `assessForwardV02Candidate` | `assessForwardV02CandidateStrictNodeIngress` | `forwardV02CandidateStrictNodeIngress.ts` |

**Audit conclusion:** no additional unpaired `assessForwardV02*` or `buildForwardV02IndependentProofRequest` entry point was found in the audited v0.2 module set. There is no demonstrated need for another assessment/builder wrapper on this head. This does **not** mean legacy callers are migrated, all possible callers are safe, or the evidence has been authenticated.

## Exported helpers: explicitly different contract

The audit also found independently callable helpers, which must **not** be counted as strict assessment/builder coverage:

- `forwardV02FormulaReferenceDigest` and `forwardV02SourceManifestReferenceDigest` in `forwardV02ReferenceReconciliation.ts`: legacy descriptor-only snapshots, shape validation and metadata hashes. Their existing tests deliberately execute malicious Proxy descriptor traps and verify that late repair does not produce an accepted hash. A hash does not attest an independent source.
- `digestForwardV02UntrustedRequest` in `forwardV02UntrustedVerifierResponse.ts`: a standalone transcript digest; it snapshots and validates the complete request before hashing. Its source contract says to call it on a preflight-built request. It is **not** a generic Proxy-trap-free direct-ingress API.
- `snapshotForwardV02UntrustedPolicy` and `snapshotForwardV02SyntheticClaim`: descriptor-only research helpers. They may encounter caller-controlled Proxy traps when invoked directly. They are not the strict multi-input assessors.
- `snapshotForwardV02UntrustedGraph` versus `snapshotForwardV02UntrustedGraphRejectingProxies`: the former intentionally retains legacy descriptor-only behavior; the latter is the opt-in Node-only guard. Neither proves independent authenticity.

**Concrete residual boundary:** a caller bypassing an opt-in strict assessor and directly invoking a legacy digest/snapshot helper on an adversarial Proxy can execute Proxy traps even when the resulting metadata is rejected. Existing `LEARN-forward-v02-standalone-reference-digest-late-descriptor-repair-20261025` and `LEARN-forward-v02-standalone-request-digest-late-repair-20261025` already cover the earlier acceptance/late-repair failure class. Do not re-label that known class as a new failure or assume the strict assessors protect unrelated direct helper invocations.

**Actionable guard:** preserve the documented direct-helper contracts and avoid unreviewed caller migration. If a real new direct untrusted caller is introduced, demonstrate its call path and trap-side-effect risk first, then either route it through the existing strict snapshot before invoking the helper or add a narrowly scoped opt-in boundary with negative tests. Do not add wrappers solely to increase a coverage count.

## Non-authority and remaining gates

- No independent trust root, independently authenticated time/revocation, terminal settlement/correction completeness, prospective frozen cohort, independently bound formula/source manifest, or approved v0.2 evaluation protocol was established.
- `candidateComplete`, matching digest, synthetic signature validity, successful structural preflight, and green CI are **not** independent evidence or scoring authorization.
- No production/Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private raw T-5 data or protected N2 run was touched.
- PR #2286 remains `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`; its large cumulative diff should not be merged merely because CI is green.

## Learning gate and next safe work

- `fingerprintKey`: `research-k3.forward-vault.v02-strict-ingress-coverage-audit`
- `attemptSignature`: `pr2286-v344-source-export-inventory-assessor-builder-vs-helper-trust-boundaries`
- `environmentKey`: `github-connector/github-actions-node24-typescript6.0.3`
- `materialStateKey`: `forward-v02-pr2286-v343-opt-in-strict-entrypoints-and-legacy-helpers`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Reused `LEARN-forward-v02-node-proxy-rejecting-ingress-20261025`, `LEARN-forward-v02-two-phase-sibling-pin-deep-capture-regression-20261025`, and the two standalone-digest Learning records above. The failed two-phase traversal was not retried.
- Classification: **REUSED_LEARNING**. This is a bounded governance finding, not a new root cause, new performance experiment, independently verified production readiness or reason for a filler `LEARN-*`.
- **Next:** trace any actual new direct untrusted digest/snapshot caller before implementing a wrapper; otherwise prioritize independent-source/clock/revocation and frozen-evaluation-contract evidence design under separate review. Keep all code and production callers unchanged until a concrete gap is reproduced.
