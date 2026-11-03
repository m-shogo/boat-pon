# Forward Vault v0.2 — PR #2286 review-slice and authority manifest (2026-11-01 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only, read-only-source inventory retained as a governance finding. It is not a merge authorization, operational deprecation decision, K-source authentication, production readiness assessment, or proposal to run any workflow. No protected N2 dispatch, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private raw T-5 data, secrets, or private paths were accessed or modified.

## Question, pinned evidence and method

**Question:** Can the unusually large open research PR be divided into independently reviewable evidence/implementation/operational-authority slices, without silently merging its legacy CLI change or treating green CI as K-data authorization?

**Method:** Read GitHub's complete paginated changed-filename inventory for [PR #2286](https://github.com/m-shogo/boat-pon/pull/2286), compare with the complete changed-filename inventory for separately owned [PR #2287](https://github.com/m-shogo/boat-pon/pull/2287), check the main/PR refs and compare metadata, read the latest-main research learning and knowledge-retention contracts, inspect prior owner-deprecation/privacy reports and relevant LEARN records, and inspect both full official CI job logs. No checkout, workflow dispatch, CI rerun, branch rewrite, or production execution.

Pinned authority at pre-write check: canonical main `2342494f6581c167a5648681ca7374b26d6659d4` (last merged Forward Vault core #2285); Draft/unmerged PR #2286 HEAD `6b97d0bef6615cf15a906a2205ad81474042cd28`; 778 commits ahead, 0 behind; 425 changed files. PR #2287 remains separate, Draft/open at `f061bb24ddc61174dd9906d9acf87512fe91d94f`. **Exact changed-path overlap: 0**, which does not prove absence of semantic or runtime integration conflicts. The GitHub compare endpoint returns only the first 300 changed-file entries here; the paginated PR filename inventory, not that truncated compare list, is the basis of the 425-file breakdown.

## Exhaustive path-classification inventory

| Review slice | Changed paths | Authority and recommended review |
| --- | ---: | --- |
| Append-only `research/registries/learnings/LEARN-*.json` | 194 | Check identity, canonical digest, lineage, repeat-suppression semantics, and no production authority. These records currently live on a Draft branch, not canonical main. Do not represent them as merged or approved. |
| `reports/research/` | 99 | Preserve evidence-stage caveats and immutable source refs; check no private raw values or paths. Reconcile reports to corresponding LEARN/implementation evidence rather than using report volume as proof of readiness. |
| `src/research/governance/**/*.test.ts` | 98 | Review synthetic and static test boundaries, test isolation, and whether assertions prove only source reachability rather than live runner behavior. |
| `src/research/governance/` non-test implementations | 27 | Review Forward Vault, strict ingress, authority/preflight, outcome/runtime ledger, and Node child-environment interfaces against schemas and K-source authority requirements. |
| `config/research-governance/*.schema.json` | 5 | Review schema parity and fail-closed unknown-field, digest, time, and provenance handling; no scoring or production adoption. |
| `scripts/run-research-task.ts` and `src/automation/legacyRunnerTaskDisabled.test.ts` | 2 | **Operational scope exception**: deprecated CLI behavior and its test, outside research-governance code paths. Explicit operations-owner disposition required before merge; do not edit or dispatch the legacy workflow for diagnostics. |
| **Total** | **425** | Complete paginated PR filename inventory; categories are mutually exclusive. |

There are **no `.github/workflows/` files in the PR diff**. This is not evidence that the main legacy workflow is disabled. In particular, its `workflow_dispatch` still invokes `automation:task`, and independent `always()` follow-up, JST-hour retention CAS writer, and conclusion-agnostic read-only audit remain governed by main's separate workflow files.

## Review and integration sequence (recommendation, not authorization)

1. **Owner-controlled integration blocker first:** obtain an explicit decision for the deprecated manual entry, its post-task helper, embedded conditional retention, completion-triggered read-only audit, and standalone retention. Retain the existing canonical intent workflow unchanged. Reuse the [owner decision matrix](forward-v02-pr2286-legacy-workflow-owner-deprecation-decision-matrix-20261101.md) and [conditional reference-log privacy audit](forward-v02-pr2286-legacy-manual-reference-log-privacy-audit-20261101.md); do not rediscover their unchanged root causes.
2. **Review research contracts as a coherent slice:** 27 implementation files + 5 schemas + 98 synthetic/static tests. Audit test coverage by mechanism and inspect negative cases; green CI alone is not independent K issuer/rights, authenticated corrections/finality, exact payout/refund/void semantics, or frozen prospective cohort proof.
3. **Review durable knowledge as a separate slice:** 194 LEARN records and 99 reports. Check append-only identity/digest, evidence links and no dangling lineage. These are durable on the PR branch but **not yet canonical-main merged records**; do not silently cherry-pick them into main without review, and do not erase/rewrite history to simplify the PR.
4. **Re-evaluate merge only after external authority is resolved:** K issuer and usage rights, independent ticket-level settlement/correction/finality evidence, frozen prospective evaluation cohort and approved scoring protocol remain missing. Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false` and the Draft merge gate closed. File-slice review is not a substitute for these proofs.

The inventory is a **review partition**, not a claim that the 425-file branch can be safely split into independently mergeable PRs. Its cross-file dependency graph has not been proven. Do not force-push, rewrite main, close another owner's PR, or activate protected N2 to determine integration behavior.

## CI and failure-layer interpretation

Exact pre-write HEAD [CI #41259369282](https://github.com/m-shogo/boat-pon/actions/runs/41259369282) completed **SUCCESS** with both `verify` and `research-governance` jobs successful. Full logs show **4,699 PASS / 2 SKIP / 0 FAIL (4,701 tests)**, TypeScript, build, replay, research governance/digest and lineage, secret-pattern and research/production-isolation checks, and successful post-job cleanup. Nonfatal Node 20 action-deprecation and `punycode` warnings remain. The official CI did **not** execute the legacy manual workflow, protected N2, an owner deprecation decision, or independent K-source verification.

A green test payload and successful process/workflow/post-job layers establish only those checks. Separately observed natural N2 Daily Readiness red runs remain governed by `LEARN-n2-daily-readiness-day-index-missing-20260920`; no unchanged diagnostic retry or synthetic readiness count is authorized.

## Learning gate

Latest-main authority: `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`. Reviewed `LEARN-legacy-manual-postfailure-retention-path-20261101`, `LEARN-legacy-manual-request-reference-raw-log-projection-20261101`, `LEARN-research-automation-legacy-commit-helper-provenance-20261031`, `LEARN-n2-daily-readiness-day-index-missing-20260920`; the historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2`; and the Rejection registry, which has no substantive records. The historical dataset discovery does not confer independent K authority.

- `fingerprintKey=research-governance.pr2286.review-slice-authority-inventory`
- `attemptSignature=pr2286-v511-paginated-path-classification-plus-ci-and-owner-gate-no-dispatch`
- `environmentKey=github-connector-pinned-main-pr-and-actions-read-only`
- `materialStateKey=main-2342494f/pr-6b97d0be/425-paths/ci-41259369282`
- Gate: `PROCEED_DISTINCT_DOCUMENTATION / REUSE_GUARDRAIL`; **classification: REUSED_LEARNING / NO_NEW_LEARNING**. No new failure class or non-obvious verified success occurred; therefore no duplicate LEARN is created.

**Next safe action:** request independent operations-owner sign-off for the two-file legacy CLI scope exception and follow-up workflow decisions, then review the 27 research implementation files and 5 schemas against the 98 synthetic/static tests while waiting for independent K-source primary evidence. Keep #2286 Draft and main canonical.
