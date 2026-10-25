# Forward Vault v0.2 direct-helper call-site audit (2026-10-26)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only source audit. This does not authenticate an independent witness, prove terminal settlement, approve a protocol, enable scoring, or authorize production. No protected N2 workflow was triggered.

## Authority and method

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; open research PR #2286, source head before this report: `6815a7179eef6026164c7c78fbf1dd51c34a3221`. No other open PR at the write gate.
- Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, the prior v344 coverage audit, and relevant `LEARN-*` records. The dataset-foundation Experiment/Discovery do not confer v0.2 authority; no relevant Rejection record is present.
- Inspected **all 29 non-test TypeScript modules in `src/research/governance/`** on the PR head, tracing named exported digest/snapshot helper definitions, imports and calls. This is a bounded **static intra-directory** audit, **not** an exhaustive repository-wide dynamic call graph, package-consumer inventory, or test of external callers. Other directories and future imports are not cleared by this finding.
- Latest report-head CI [#40238393611](https://github.com/m-shogo/boat-pon/actions/runs/40238393611): verify and research-governance SUCCESS; 4,504 PASS, 2 SKIP, 0 FAIL; post-job cleanup SUCCESS. This audit made no code changes and did not run a new local test.

## Concrete internal call-site inventory

| Exported legacy helper | Non-test call sites in the 29-module scope | Boundary and consequence |
| --- | --- | --- |
| `forwardV02FormulaReferenceDigest` | `assessForwardV02ReferenceReconciliation` in `forwardV02ReferenceReconciliation.ts` | Called on the reconciler's detached `references.formula`; direct exported calls still use the descriptor-only snapshot, not a Proxy-rejecting boundary. |
| `forwardV02SourceManifestReferenceDigest` | `assessForwardV02ReferenceReconciliation` in the same module | Called on detached `references.sourceManifest`; matching digest is not independent source attestation. |
| `digestForwardV02UntrustedRequest` | `assessForwardV02UntrustedVerifierResponse`, `assessForwardV02SyntheticEd25519Claim`, `assessForwardV02SyntheticClaimedAnchorBinding`, `assessForwardV02SyntheticReferenceAnchorConflict` | These call it with `built.request` returned by the independent proof request builder, not with a separately forwarded live request argument. The exported helper itself remains directly callable and descriptor-only. |
| `snapshotForwardV02UntrustedPolicy` | `assessForwardV02SyntheticClaimedAnchorBinding`, `assessForwardV02SyntheticReferenceAnchorConflict` | The legacy synthetic assessors use this descriptor-only snapshot. Their opt-in strict counterparts capture caller inputs before delegating. |
| `snapshotForwardV02SyntheticClaim` | `assessForwardV02SyntheticEd25519Claim`, `assessForwardV02SyntheticClaimedAnchorBinding`, `assessForwardV02SyntheticReferenceAnchorConflict` | Same legacy/strict split; the helper itself is not a strict direct-ingress API. |
| `snapshotForwardV02UntrustedGraph` | Legacy candidate, batch, metadata, proof request, reconciliation, parity, outcome, synthetic, verifier and other research preflight modules | Deliberately retains descriptor-only behavior. `snapshotForwardV02UntrustedGraphRejectingProxies` is a separate opt-in Node-only primitive. |

The strict synthetic wrappers in `forwardV02SyntheticStrictNodeIngress.ts` and `forwardV02SyntheticEd25519ClaimStrictNodeIngress.ts` first capture each caller-supplied graph with `snapshotForwardV02UntrustedGraphRejectingProxies`, then pass detached values to the unchanged legacy assessors. This is **not** proof of cross-input atomicity against arbitrary external writers. Other strict wrappers follow the same opt-in research design as documented in v344.

## Finding and decision

**No additional direct untrusted helper caller requiring a new wrapper was demonstrated within the 29 inspected non-test governance modules.** The actual internal helper calls are in legacy assessment/builder chains or consume a preflight-built request; the strict paths are opt-in and are not silently wired into legacy entry points. This finding must **not** be generalized to all scripts, tests, external consumers, or future code.

The known residual risk remains: a direct caller can hand a malicious Proxy to a legacy exported digest/snapshot helper and cause descriptor/ownKeys/prototype traps to execute, even if the helper rejects the resulting claim. Prior `LEARN-forward-v02-standalone-reference-digest-late-descriptor-repair-20261025`, `LEARN-forward-v02-standalone-request-digest-late-repair-20261025` and `LEARN-forward-v02-node-proxy-rejecting-ingress-20261025` already establish the distinction. Do **not** repeat the blocked two-phase shallow/deep snapshot traversal from `LEARN-forward-v02-two-phase-sibling-pin-deep-capture-regression-20261025`.

**Decision: no API migration, no new wrapper, and no additional test fixture without a concrete caller or changed material state.** For a newly proposed direct untrusted caller, require an explicit call-chain diagram, preflight-owned versus caller-owned object identity, adversarial trap-side-effect test, and a reviewed opt-in strict boundary before admission. Do not use this audit to infer a trusted clock, independent proof, complete correction chain, readiness count, or scoring authorization.

## Red-workflow interpretation (read-only)

- Natural N2 Daily Readiness [#40218434947](https://github.com/m-shogo/boat-pon/actions/runs/40218434947): research payload `DAILY_PLAN_MISSING`, process exit **3**, job/workflow **FAILURE**; checkout post-job and complete-job steps **SUCCESS**. No runner/platform fault established. No rerun or protected activation.
- Earlier v332 PR CI [#40191810250](https://github.com/m-shogo/boat-pon/actions/runs/40191810250): three **research test** failures (4,432 pass / 3 fail / 2 skip), process exit **1**, verify job **FAILURE**, research-governance **SUCCESS**, cleanup **SUCCESS**. The attempted two-phase traversal was abandoned; current latest-head CI is green. Adjacent failed v332 attempts show the same research-test family, not a proven infrastructure incident.

## Learning gate, blockers and next safe action

- `fingerprintKey=research-k3.forward-vault.v02-direct-helper-callsite-audit`
- `attemptSignature=pr2286-v345-static-callsite-trace-29-nontest-governance-modules`
- `environmentKey=github-connector/github-actions-node24-typescript6.0.3`
- `materialStateKey=forward-v02-pr2286-v344-legacy-helpers-opt-in-strict-entrypoints`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Classification: **REUSED_LEARNING**. No new cause/failure or non-obvious reusable success warrants a filler `LEARN-*`; existing append-only records are unchanged.
- Still missing: independently provisioned witness/trust root, verifiable time and revocation, authenticated terminal settlement and full correction history, prospective frozen membership, independently bound formula/source manifest, approved v0.2 evaluation protocol.
- Next safe action: **design/review a minimal external-witness and terminal-source verification fixture contract**, explicitly separating trusted provisioning from caller claims; do not connect it to scoring. Reopen direct-helper hardening only when an actual new untrusted call path is shown.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private raw evidence or protected N2 changes. Main remains canonical and this PR remains **DO_NOT_MERGE_CANDIDATE**.
