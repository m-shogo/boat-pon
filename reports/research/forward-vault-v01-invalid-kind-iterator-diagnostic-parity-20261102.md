# Forward Vault v0.1 — invalid-kind diagnostic integrity under ambient array iteration (2026-11-02 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Bounded research-only implementation/schema/test review. This report is not K issuer/usage-rights evidence, a readiness claim, a scoring protocol approval, or production authority. No protected N2 dispatch, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private T-5 values, secrets or private paths were accessed or changed.

## Question, authority and evidence

Can the v0.1 validator preserve the complete *reason for rejection* when an unknown `kind` arrives alongside earlier field errors, even if a caller has replaced `Array.prototype[Symbol.iterator]`?

Pinned canonical main: `2342494f6581c167a5648681ca7374b26d6659d4` (merged research foundations [#2284](https://github.com/m-shogo/boat-pon/pull/2284) and [#2285](https://github.com/m-shogo/boat-pon/pull/2285)). Pinned pre-report Draft [#2286](https://github.com/m-shogo/boat-pon/pull/2286) HEAD: `6f979e66e02489ff2c1eb5333c83c0f6e7b94d31`, unmerged. Separate Draft #2287 owns LINE changes. Read latest-main learning/retention contracts, the v0.1 schema, `forwardEvaluationVault.ts`, the existing iterator and error-sink regressions, and the prior LEARN below. Historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` remain exploration lineage, not external K rights or prospective scoring evidence. No substantive Rejection record was introduced by this PR.

## Concrete bounded finding and remediation

The v0.1 [schema](../../config/research-governance/forward-evaluation-vault.schema.json) requires `kind` and defines five record kinds; the runtime rejects unknown kinds. But its early-return branch constructed the diagnostic list as `[...e, "invalid kind"]`. The spread uses the ambient array iterator, unlike the existing indexed validation loops. With an empty replacement iterator, the rejection remained `valid=false` but preceding `recordId` and `evidenceStage` errors disappeared. **This was diagnostic loss, not an observed invalid-record admission or digest collision.**

- [Source correction `e5b679e`](https://github.com/m-shogo/boat-pon/commit/e5b679e68057406d4383928fcc231d03315cd383): route `invalid kind` through the existing own-index `appendError` sink and return the same frozen array. No schema or kind-policy change.
- [Synthetic regression `6f979e6`](https://github.com/m-shogo/boat-pon/commit/6f979e66e02489ff2c1eb5333c83c0f6e7b94d31): a whitespace-only `recordId`, unknown `evidenceStage` and unknown `kind` must retain all three ordered diagnostics with an empty ambient iterator; append remains `REJECTED_INVALID`, digest throws, errors remain frozen. Existing count-admission and unknown-field tests are unchanged.
- Schema/runtime distinction: JSON Schema constrains accepted records, not the order/completeness of runtime error messages. The new regression covers that runtime-specific contract. The schema still cannot independently authenticate clock, issuer, correction/finality, payout, cohort freeze or protocol approval.

The [previous ambient-iterator Learning](../../research/registries/learnings/LEARN-forward-vault-v01-ambient-array-iterator-count-20261102.json) already says validation and diagnostics must not delegate to the mutable iterator. The [error-sink Learning](../../research/registries/learnings/LEARN-forward-vault-validation-error-sink-inherited-index-setter-20261028.json) already establishes own-index `Object.defineProperty` for denial preservation. This is reuse of an existing root-cause guardrail at a distinct code site; no duplicate LEARN record.

## Verification layers and unresolved authority

Pre-report exact-code HEAD [Actions #41418026231](https://github.com/m-shogo/boat-pon/actions/runs/41418026231) was **not yet verified complete at report pre-write** (observed workflow state: `in_progress`; conclusion: `none`). This report commit needs its **own exact-HEAD CI**; do not infer success from the preceding run. Earlier [#41410906206](https://github.com/m-shogo/boat-pon/actions/runs/41410906206) completed both verify and research-governance successfully, with 4,773 PASS / 2 SKIP / 0 FAIL and successful post-job cleanup.

Natural N2 [Feature Rollup #41378629638](https://github.com/m-shogo/boat-pon/actions/runs/41378629638) was workflow SUCCESS with internal `NO_DATA`; it does not confer readiness. Earlier [#41328397727](https://github.com/m-shogo/boat-pon/actions/runs/41328397727) remains workflow FAILURE: visible research step and post-steps succeeded, while the final job result is red and full log retrieval returned `404 BlobNotFound`. Process-exit, runner/platform and final attribution are **unclassified**, not assumed transient or a research-method failure. No protected rerun.

Independent blockers remain K issuer/rights, authenticated inclusive correction/finality and exact refund/void/settlement evidence, frozen prospective cohort and approved evaluation protocol, and explicit owner disposition of the legacy manual workflow's task/retention/audit follow-ups. Keep Draft, `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`; no merge or promotion.

## Learning gate

- `fingerprintKey=research-k3.forward-vault.v01.ambient-array-iterator-diagnostic-loss`
- `attemptSignature=pr2286-v543-invalid-kind-append-error-instead-of-ambient-array-spread`
- `environmentKey=github-connector-pinned-pr-source/github-actions-node24-synthetic`
- `materialStateKey=forwardEvaluationVault.ts@879046bd/v01-invalid-kind-spread-error-list`
- Gate: `REUSE_GUARDRAIL / PROCEED_DISTINCT_CODE_SITE`; reuse `LEARN-forward-vault-v01-ambient-array-iterator-count-20261102` and `LEARN-forward-vault-validation-error-sink-inherited-index-setter-20261028`.
- Classification: `REUSED_LEARNING / NO_NEW_LEARNING`. No new root-cause class or non-obvious independent success is claimed. The regression is an engineering guardrail, not an external-evidence advancement.

**Next safe action:** inspect the exact new-HEAD CI and review another bounded schema/implementation/test slice; independently seek K source authority and operations-owner decisions. Do not merge or activate protected N2.
