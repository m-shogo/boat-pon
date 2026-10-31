# Forward Vault v0.2 — legacy workflow / CLI post-merge compatibility audit (2026-11-01 JST)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, static source and governance review. This document does not authorize changing a GitHub Actions workflow, dispatching a legacy task, activating protected N2, modifying Current BUY/LINE/public publishing/Owner Dashboard, or connecting research to production. No private evidence, raw T-5 odds, credentials or private paths were accessed.

## Question and hypothesis

**Question:** Does the proposed fail-closed change to the legacy CLI preserve the existing manual workflow's behavior, and does a green PR CI establish that the operational route is disabled?

**Hypothesis:** The Draft branch's CLI guard is verified for synthetic no-request calls, but the unchanged, owner-guarded manual workflow on `main` still invokes the legacy `task` alias. The current live-main route and the hypothetical post-merge route therefore have different control flow. The PR CI does not execute the manual self-hosted workflow.

## Pinned authorities and reproducible static trace

- Canonical `main`: `2342494f6581c167a5648681ca7374b26d6659d4`; PR #2286 pre-write Draft HEAD `9bfddf9b60a67a5b0fae71ecc9084c8115605cff`; PR #2287 is separately owned LINE work and was not modified.
- [Manual local research workflow](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/.github/workflows/boat-pon-local-research.yml) declares `workflow_dispatch` (lines 9–36). The `guard` requires owner actor, repository identity, `refs/heads/main` and approved safety levels (lines 58–75). `run-one-task` checks out **main** on a self-hosted macOS runner (lines 78–87), builds and validates a legacy request (lines 89–106), and runs `pnpm automation:task -- --request=data/tmp/automation/request.json` (lines 108–111). Status and result-commit steps have `if: always()` (lines 113–123).
- [Main `package.json`](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/package.json) binds `automation:task` to `tsx scripts/run-research-task.ts task`. The [main legacy runner](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/scripts/run-research-task.ts) emits `DEPRECATED` but **does not terminate** in task mode; after request/preflight guards it retains a READY-task executor branch. This is the already-recorded warning-only governance mismatch, not a newly observed execution.
- The [Draft runner patch](https://github.com/m-shogo/boat-pon/pull/2286/files) instead returns exit **3** with `DEPRECATED_DISABLED` for `task` **before policy/request parsing**, and returns exit 3 for unknown modes. Its executor import becomes lazy. The [Draft regression test](https://github.com/m-shogo/boat-pon/blob/9bfddf9b60a67a5b0fae71ecc9084c8115605cff/src/automation/legacyRunnerTaskDisabled.test.ts) covers synthetic absent-request/empty-workspace denial and source ordering, not an operational manual workflow run.
- The separate [canonical intent workflow](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/.github/workflows/boat-pon-intent-dispatch.yml) invokes `automation:intent-task` (line 146) and obtains control-state authority from the automation branch. The [request-file dispatch stub](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/.github/workflows/boat-pon-request-file-dispatch.yml) only prints a deprecation notice. Neither file is the manual local-research workflow.

## Static compatibility matrix (not an execution result)

| Route / authority | Expected behavior from source | Evidence limit |
| --- | --- | --- |
| Current `main`, manual local-research `run-one-task` | Calls warning-only legacy `task` mode; request/preflight/safety/READY gates still apply. | No successful dispatch, safety bypass or actual N2 run demonstrated. |
| Draft #2286 CI checkout | Tests early exit 3 for deprecated/unknown modes using absent synthetic requests. | CI does **not** test the self-hosted manual workflow's integration or live enabled state. |
| **If** Draft CLI were merged without changing manual workflow | The same manual `run-one-task` command would terminate at `DEPRECATED_DISABLED` with exit 3, regardless of request action (`run-task`, `status-only`, `dry-run`). | Conditional source-level consequence; **no merge or live failure occurred**. |
| Canonical intent dispatch | Uses `automation:intent-task`, not the legacy alias. | Separate authority/runner path; not evidence that every legacy workflow is disabled. |
| Legacy request-file dispatch stub | Only emits notice; does not call `automation:task`. | Does not govern the separate local-research workflow. |

**Integration implication:** A merged CLI guard would intentionally stop legacy execution, but the unchanged manual workflow would then report a failed `run-one-task` step rather than a clean deprecation/stub outcome. Its `if: always()` follow-up steps may still be attempted; their behavior was **not** executed or verified. The workflow YAML's `workflow_dispatch` trigger is present, but its live GitHub enabled/disabled setting and self-hosted runner availability were **not independently verified**. Do not equate YAML presence with observed execution or operational availability.

## Review gate / safe decision

1. **Keep Draft / no merge.** An authorized operational owner should decide whether to retire the manual local-research workflow, replace its execution job with an inert notice, or retain it under a separately approved migration. Do not silently restore legacy `task` execution to make the workflow green.
2. If an approved operational change is proposed, review the manual workflow's `if: always()` status/commit steps and the legacy request builder's L3-vs-L0/L1/L2 discrepancy. Review exact trigger and branch authority without dispatching protected N2 or supplying a valid legacy task request.
3. Keep the synthetic no-request early-denial tests and lazy import guardrail. Require an explicit separate operational compatibility test/review before any production-facing workflow change. Do not infer current BUY/LINE safety or K-data scoring authority from this review.

## Learning and CI authority

Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`. Reused append-only `LEARN-research-automation-legacy-task-mode-warning-only-20261030`, `LEARN-research-automation-legacy-task-fail-closed-verified-20261031`, `LEARN-research-automation-legacy-prepolicy-denial-verified-20261031` and `LEARN-research-automation-legacy-lazy-executor-import-verified-20261031`. Main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` concern historical inventory, not K rights or forward scoring; main Rejection directory contains only `.gitkeep`. Merged #2284/#2285 provide Forward Vault foundations, not promotion authority.

- `fingerprintKey=research-automation.legacy-manual-workflow.cli-deprecation-postmerge-compatibility`
- `attemptSignature=pr2286-v503-main-workflow-package-cli-branch-control-flow-cross-check-no-dispatch`
- `environmentKey=github-connector-pinned-main-and-draft-static-read/actions-ubuntu-node24-synthetic-ci`
- `materialStateKey=manual-workflow-95094e7/package-8b72a00/legacy-main-cce9559/legacy-draft-04113e1`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. This is a more precise integration consequence of a previously documented legacy-route issue, not an observed new runtime failure or a newly verified reusable remediation; no duplicate `LEARN-*` is created.

At pre-write HEAD, [CI #41222816665](https://github.com/m-shogo/boat-pon/actions/runs/41222816665) concluded **SUCCESS** for `verify` and `research-governance`, including their post-checkout steps. This establishes synthetic PR validation only. It is not a manual-workflow execution, K issuer/usage-rights proof, authenticated settlement/correction/finality, frozen prospective cohort or approved scoring protocol. `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. No readiness counts are inferred.

**Next safe action:** seek separate operational-owner signoff on the legacy workflow's desired deprecation behavior and platform enabled state; continue independent K issuer/rights and ticket-level finality evidence review without dispatch or production changes.
