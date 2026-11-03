# Forward Vault research — cross-record authority and test trace (2026-11-02 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only, append-only governance finding on the existing Draft PR #2286. It is **not** K issuer/usage-rights evidence, independent correction/finality/settlement proof, a frozen prospective cohort, an approved scoring protocol, or permission to merge or change production. No workflow dispatch, protected N2 diagnostic activation, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private raw T-5 values, secrets, or private paths were accessed or changed.

## Question, pinned state, and method

**Question:** Which checks in the current Forward Vault record → cross-ledger → v0.2 trust/preflight chain are *structural* versus *independently authoritative*, and what exactly do the existing tests establish?

**Pinned pre-write state:** canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; [PR #2286](https://github.com/m-shogo/boat-pon/pull/2286) OPEN/Draft/unmerged at `90b634b5c4751ed2a51a8b91a6501ff8cade931f`, 868 commits and 479 changed paths; separate [PR #2287](https://github.com/m-shogo/boat-pon/pull/2287) OPEN/Draft at `f061bb24ddc61174dd9906d9acf87512fe91d94f`, owned by LINE work. No merge SHA. The [exact-HEAD CI #41418143518](https://github.com/m-shogo/boat-pon/actions/runs/41418143518) completed SUCCESS, with full verify and research-governance logs inspected: **4,774 PASS / 2 SKIP / 0 FAIL**, typecheck, build, replay, schema/lineage/digest, secret scan, production-isolation and post-job cleanup successful. This CI predates the present report commit.

Read latest-main [Research Learning Loop](../../docs/architecture/research-learning-loop.md) and [Knowledge Retention Contract](../../docs/architecture/research-knowledge-retention-contract.md); pinned PR schema, validator, cross-record admission, candidate protocol, outcome linkage, trust-policy preflight, and named regression tests. Reviewed historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` as exploration/inventory lineage, not current independent K authority; no new substantive Rejection lineage was established. Recent merged settlement/payout-gating research PRs do not grant this Draft external authority.

## Bounded contract-to-test trace

| Layer / input | What source and tests actually establish | What is **not** established |
| --- | --- | --- |
| **v0.1 ENROLLMENT_PROTOCOL** — `forwardEvaluationVault.ts`, `forward-evaluation-vault.schema.json` | Fixed kind/fields, unique nonblank rule and ticket arrays, claimed time bounds, digest admission; validator and schema-boundary regressions | Independent protocol pre-registration, issuer identity, externally witnessed freeze, approved eligibility |
| **v0.1 MEMBERSHIP** | Required cohort/decision/enrollment IDs and SHA-shaped references, included boolean, claimed enrollment instant; unknown outcome fields rejected | Actual prospective enrollment, independent decision evidence, population completeness |
| **v0.1 ANALYSIS_SNAPSHOT** | Nonempty unique membership digest array, cohort/cutoff fields and canonical record digest | A complete frozen cohort or independently authenticated membership set |
| **v0.1 EVALUATION_PROTOCOL** | Mode, odds basis, nonempty unique metric-family/benchmark arrays and explicit unresolved policy; `resultMatchesProtocol` checks digest, stage, creation ordering, mode, odds basis, metric-family membership | Frozen formula/denominator, exact refund/void/max-hit treatment, independent approval |
| **v0.1 RESULT** | Safe nonnegative counts, finite metrics, manifest/protocol/snapshot SHA-shaped references; direct digest and append are fail-closed for malformed records | True sample size, payout correctness, provenance of `sourceManifestDigest`, valid ROI or scoring readiness |
| **Cross-record `forwardScoringAdmission.ts`** | Binds one synthetic enrollment/membership/snapshot/protocol/result/decision/outcome graph by IDs, digests, stage, ticket and chronology. `forwardScoringAdmission.test.ts` covers a fully matching synthetic fixture, refund/void, stage, time and identity denials | The caller-reported `reconciliation: "EXACT"` is not independent settlement attestation; **every** path returns `scoringAuthorized:false`, including a matching graph |
| **v0.2 candidate + outcome-link preflight** | `forwardEvaluationProtocolV02Candidate.ts` requires explicit unapproved formula/outcome/exclusion policy; `forwardV02OutcomeLinkPreflight.ts` matches supplied decision/outcome digests and exact ticket identities, denies incomplete linkage. Named tests cover missing decisions, duplicate settlements, refunds and digest changes | Independent source manifest, verified correction chain, prospective witness, approved protocol; both APIs remain deny-only |
| **v0.2 trust-policy/proof request** | `forwardV02TrustPolicyPreflight.ts` checks caller-supplied anchor roles, validity windows, revocation flags and proof-ref consistency. `forwardV02IndependentProofRequest.ts` exports bounded *untrusted* metadata, not raw private evidence. Tests reject revoked/out-of-window and self-asserted authorization | Independently provisioned public keys, actual signature verification, trusted clock, revocation-log inclusion, terminal source finality or rights grant; `independentAuthorityVerified:false` and `scoringAuthorized:false` are invariant |

**Review finding:** The implementation distinguishes structural/digest consistency from external authority. In particular, a valid v0.1 `RESULT`, a matching `resultMatchesProtocol`, a caller's `EXACT` reconciliation flag, or a syntactically `REVIEWED` v0.2 trust policy must **not** be represented as independently verified performance evidence. The current deny-only boundary is intentional and tested; this review did not establish a new validation bypass or new failure class.

**Review limit:** Named tests and official CI show that the checked synthetic code paths ran. They do not exercise an authenticated K issuer feed, independently signed witness, real settlement revision/finality proof, production runner readiness, or approval by an operations owner. No readiness count is inferred.

## Independent acceptance evidence and safe next action

1. **External K issuer/rights:** attributable publishing/licensing party, versioned terms and permitted collection/retention/research scope; a request packet or claimed host is not a grant.
2. **Correction/finality/settlement:** authenticated inclusive revision/supersession/revocation evidence, terminal checkpoint, exact ticket payout/refund/void/cancellation mapping and independent source reconciliation.
3. **Prospective evaluation:** externally witnessed freeze and fixed eligible universe before decisions; independently reviewed scoring formula, denominator, exclusion and max-hit policy; versioned approval separate from synthetic candidate completeness.
4. **Operational integration:** explicit owner disposition for the legacy manual entry, post-task helper, conditional retention CAS writer, conclusion-agnostic read-only audit and standalone retention. Reuse [the existing owner matrix](forward-v02-pr2286-legacy-workflow-owner-deprecation-decision-matrix-20261101.md); do not dispatch or alter workflows to discover their behavior.
5. **PR review:** review the 27 implementation paths and five schemas in bounded slices, with test claims classified as structural versus external. This report adds a claim/authority trace, **not** another implementation patch or a merge recommendation.

## CI and protected N2 failure-layer separation

- [Official PR CI #41418143518](https://github.com/m-shogo/boat-pon/actions/runs/41418143518): research payload tests PASS, process/job/workflow SUCCESS, post-job cleanup SUCCESS; runner/platform failure not evidenced. Node 20 action-deprecation and `punycode` warnings are nonfatal.
- [Naturally scheduled N2 Feature Rollup #41378629638](https://github.com/m-shogo/boat-pon/actions/runs/41378629638): workflow/job SUCCESS, research payload **NO_DATA**, post-job SUCCESS. A successful workflow does **not** imply usable research data or readiness.
- [Earlier natural N2 #41328397727](https://github.com/m-shogo/boat-pon/actions/runs/41328397727): workflow/job FAILURE; visible research and post-job steps SUCCESS, final Complete job unresolved. Full job log fetch failed (404/BlobNotFound); process-exit detail, runner/platform and final failure attribution remain **unclassified**. No diagnostic dispatch or rerun.

## Learning gate

- `fingerprintKey=research-governance.pr2286.cross-record-authority-claim-trace`
- `attemptSignature=pr2286-v544-v01-five-kind-to-cross-ledger-v02-trust-and-test-matrix-no-dispatch`
- `environmentKey=github-connector-pinned-main-pr-source-and-actions-read-only`
- `materialStateKey=main-2342494f/pr-90b634b5/schema-v01-and-v02-preflight/ci-41418143518`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT_REVIEW_SLICE**. Reused `LEARN-legacy-manual-postfailure-retention-path-20261101`, `LEARN-n2-daily-readiness-day-index-missing-20260920` and the v0.1 ambient iterator/error-sink guardrails. This is a distinct cross-record claim trace, not a retry of the earlier 479-file count inventory or an unchanged protected N2 attempt.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. No new LEARN is warranted for a documentation-only authority mapping or routine green CI.

**Next safe action:** independently obtain the issuer/rights and correction/finality evidence and the operations-owner decisions; continue bounded implementation/schema/test review without connecting research to production. Keep #2286 Draft, `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. This report's new exact-HEAD CI must be checked separately before claiming green.
