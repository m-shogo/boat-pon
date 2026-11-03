# Forward Vault Draft PR #2286 — test ownership and reviewer triage (2026-11-02 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, append-only governance finding. This inventory is **not** proof of behavioral coverage, independent K issuer/usage rights, authenticated settlement/finality, prospective enrollment, approved scoring, or permission to merge. No protected N2 dispatch/rerun, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private raw T-5 odds, secrets or private paths were accessed or changed.

## Question and pinned authority

**Question:** Does the absence of an identically named `*.test.ts` for a changed research module mean the Draft has no test at all, and which paths need manual reviewer attention rather than a misleading filename-only coverage claim?

**Method:** Read complete paginated changed-path inventories for research [PR #2286](https://github.com/m-shogo/boat-pon/pull/2286) and separately owned [PR #2287](https://github.com/m-shogo/boat-pon/pull/2287), inspect all five non-exact-match source modules and their named importing tests, read the five changed schema paths and candidate schema-parity test filenames, and inspect latest-main learning/retention contracts plus relevant LEARN/Experiment/Discovery history. This is a **source/import inventory**, not instrumentation-based coverage or runtime integration testing.

Pre-write canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Draft/unmerged PR #2286 HEAD: `a97d19350e7d688034111ec25c04975ef8c5ceb0`, 869 commits / 480 changed paths; separate Draft PR #2287 HEAD `f061bb24ddc61174dd9906d9acf87512fe91d94f` owns LINE-related work. The two PR changed-path sets have no overlap; semantic conflicts are not excluded. Exact-head [official CI #41425892428](https://github.com/m-shogo/boat-pon/actions/runs/41425892428) completed SUCCESS on that HEAD, with 4,774 PASS / 2 SKIP / 0 FAIL, typecheck, build, replay, research governance, LEARN integrity, secret/isolation checks and post-job cleanup verified in both full job logs. This CI **predates this report commit**.

## Concrete test ownership finding

The changed research-governance surface contains **27 non-test TypeScript modules, 125 `*.test.ts` files and five JSON schemas**. Exactly **22 of 27 modules** have a changed test with the same basename. The remaining **five are not untested merely because their filenames differ**: the following changed tests import them directly (confirmed from source).

| Changed implementation without same-basename test | Confirmed changed importing test(s) | Review caution |
| --- | --- | --- |
| `executorSdk.ts` | `executorSdk.pitCallbackException.test.ts`, `executorSdk.pitEvidenceBoundary.test.ts`, `executorSdk.writeScopeBoundary.test.ts` | These tests target PIT failure, dry-run and write scope; they do **not** establish coverage for every exported helper, atomic filesystem path or orchestration outcome. |
| `forwardV02SyntheticClaimedAnchorBinding.ts` | `forwardV02SyntheticEd25519Claim.test.ts`, `forwardV02SyntheticStrictNodeIngress.test.ts` | Caller-claimed key correlation only; matching synthetic signatures/anchors never authenticate external authority. |
| `forwardV02SyntheticReferenceAnchorConflict.ts` | `forwardV02SyntheticEd25519Claim.test.ts`, `forwardV02SyntheticStrictNodeIngress.test.ts` | A second caller-supplied reference is still untrusted; test of correlation is not proof of independent provisioning or revocation. |
| `forwardV02UntrustedSnapshot.ts` | `forwardV02UntrustedSnapshot.strictProxyBoundary.test.ts` | Node-only strict Proxy rejection and legacy descriptor-copy paths are distinct; no cross-input atomicity or independent authentication is established. |
| `researchNodeChildEnv.ts` | `researchNodeChildEnv.execFile.test.ts` | Sanitizing inherited `NODE_OPTIONS` for research subprocess fixtures is not a general sandbox or runner integrity guarantee. |

**Important distinction:** 22 basename matches + five verified import mappings establishes discoverability, **not** 27 fully covered modules. The next reviewer should inspect assertions and execution branches rather than report a percentage of statement/branch coverage. No code coverage instrumentation was run here.

## Schema-to-test reviewer queue

Five changed schemas: `forward-evaluation-vault.schema.json`, `forward-v02-authority-metadata.schema.json`, `outcome-learning-ledger.schema.json`, `runtime-decision-ledger.schema.json`, `runtime-decision-ledger-shadow-evidence.schema.json`. Named changed schema tests include `forwardEvaluationVault.schemaLexicalParity.test.ts`, `forwardEvaluationVault.schemaOffsetParity.test.ts`, `forwardV02AuthorityMetadata.schemaContract.test.ts`, `outcomeLearningLedgerSchemaNonblankParity.test.ts`, and `runtimeDecisionLedgerSchemaParity.test.ts`. **There is no changed test whose filename explicitly says `runtimeDecisionLedgerShadowEvidence.schemaParity`**; this is a reviewer lookup cue, *not* proof that the shadow schema lacks tests. Inspect its existing `runtimeDecisionLedgerShadowEvidence*.test.ts` assertions before concluding there is a coverage gap.

**Prioritized safe next audit:** compare each of these five schema contracts to its runtime validator, focusing on unknown fields, exact claimed instants, digest references, nonfinite numeric values, and evidence-stage separation. Check imported tests' actual negative cases, not just file presence. Record a distinct failure only after a reproducible counterexample; do not manufacture a readiness count or claim missing tests based solely on naming.

## Authority, failure layers, and learning gate

Latest-main [Research Learning Loop](../../docs/architecture/research-learning-loop.md) and [Knowledge Retention Contract](../../docs/architecture/research-knowledge-retention-contract.md) require semantic fingerprinting, reuse of prior guardrails, and separation of research evidence from production. Reused the earlier [review-slice manifest](forward-v02-pr2286-review-slice-and-authority-manifest-20261101.md), [cross-record authority trace](forward-v02-pr2286-cross-record-authority-and-test-trace-20261102.md), `LEARN-n2-daily-readiness-day-index-missing-20260920` and relevant Forward Vault ambient-admission LEARN records. Historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` describe exploration/inventory, not a current issuer grant, frozen forward cohort, or accepted scoring protocol. No new substantive Rejection lineage is established.

- `fingerprintKey=research-governance.pr2286.nonbasename-test-import-provenance`
- `attemptSignature=pr2286-v545-five-nonbasename-import-check-plus-five-schema-review-queue-no-dispatch`
- `environmentKey=github-connector-main-and-draft-static-source-plus-official-actions-read-only`
- `materialStateKey=main-2342494f/pr-a97d1935/27-impl-125-tests-5-schemas/ci-41425892428`
- Learning gate: `REUSE_GUARDRAIL / PROCEED_DISTINCT_IMPORT_TRACE`. Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. No new root-cause failure or non-obvious reusable execution success was demonstrated; do not create a redundant LEARN record.

**CI/failure separation:** official PR CI test payload, process/job/workflow and post-job cleanup succeeded at the pinned prior HEAD. Naturally scheduled [N2 Feature Rollup #41378629638](https://github.com/m-shogo/boat-pon/actions/runs/41378629638) succeeded at workflow/job level but returned research `NO_DATA`, not readiness. Earlier natural [N2 #41328397727](https://github.com/m-shogo/boat-pon/actions/runs/41328397727) was red despite visible payload and post-job steps succeeding; its full job log remains unavailable, so process/runner/platform root cause is unclassified. No protected rerun or dispatch.

**Remaining blockers:** independent K publisher and rights, authenticated correction/finality/refund/void evidence, witnessed frozen prospective cohort, approved evaluation protocol, and the operations owner's separate decision on legacy manual workflow and follow-ups. Keep #2286 Draft, `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. Do not merge before independent approvals.
