# Forward Vault v0.2 — legacy manual workflow / trusted commit-helper input provenance (2026-10-31 JST)

**Disposition: NEW_FAILURE (static governance-contract mismatch), ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a source-only research audit. No dispatch, self-hosted execution, protected N2, production/Current BUY/LINE/public/Owner Dashboard change, private data, or operational configuration change.

## Question and distinct hypothesis

Prior [v472](forward-v02-pr2286-legacy-task-dispatch-control-flow-audit-20261030.md) showed the legacy `automation:task` mode warns but does not terminate. [v473](forward-v02-pr2286-legacy-manual-dispatch-historical-run-audit-20261030.md) identified a successful **historical** owner-initiated dry-run/push, and [v474](forward-v02-pr2286-legacy-dry-run-replay-ledger-semantics-20261030.md) distinguished local `DRY_RUN_OK` and terminal request-ledger effects. This audit tests a *different* boundary: **does the current legacy workflow explicitly supply the trusted provenance required by the current post-task Git persistence helper?**

Hypothesis: the canonical intent workflow was updated to bind trusted helper inputs, but the old manual workflow retained a bare helper invocation. Therefore local task side effects and durable branch persistence can diverge.

## Pinned source evidence (main and PR HEAD share these blobs)

| Boundary | Pinned blob | Observation |
| --- | --- | --- |
| `.github/workflows/boat-pon-local-research.yml` | `95094e766434` | Manual `workflow_dispatch` + owner/main guard. The `run-one-task` job invokes `pnpm automation:task`, then an `if: always()` commit step with **only `RUN_ID` explicitly bound** and `bash scripts/automation-commit.sh`. No trusted Git/Node path, pinned automation-branch base SHA, or trusted-helper restore step is declared in this workflow. |
| `scripts/automation-commit.sh` | `bf7a0dc94013` | Reads `TRUSTED_GIT_BIN` and `TRUSTED_NODE_BIN` at startup and **exits 1** unless both are absolute, executable paths. For a nonempty allowlisted change set, also requires a 40-hex `EXPECTED_AUTOMATION_BRANCH_BASE` before branch fetch/commit. The check is fail-closed; no automatic fallback to `command -v`. |
| `.github/workflows/boat-pon-intent-dispatch.yml` | `1db7abc8cc2f` | Canonical path captures trusted Git/Node paths, digests, branch base and helper bytes before task execution; restores helpers and binds `TRUSTED_GIT_BIN`, `TRUSTED_NODE_BIN`, `EXPECTED_AUTOMATION_BRANCH_BASE` and token in the post-task step. |
| `scripts/run-research-task.ts` | `cce9559ea4cb` | `finish` writes local status and terminal request outcome before exit. It does not itself prove Git branch persistence. |

**Conditional consequence, not an observed run:** In a clean step environment where the legacy workflow has no externally injected trusted-bin variables, the helper exits at the initial path check **even when there are no changed files**, because the check precedes the no-change return. With externally injected paths, execution could proceed further, but the workflow does not establish their trusted provenance; for nonempty changes it also lacks a workflow-pinned branch-base SHA. We did not inspect self-hosted machine-level variables, task-written `GITHUB_ENV`, or live runner state, so **do not claim a guaranteed current run failure or a proven bypass**.

The old [Actions #30821403218](https://github.com/m-shogo/boat-pon/actions/runs/30821403218) success was at `7f2f370ce244` on 2026-08-03; its then-current commit helper was different. It cannot validate the current helper/workflow combination. The current manual workflow's platform enabled/disabled state remains unverified. A GitHub workflow YAML trigger is not proof that a dispatch is currently accepted.

## Risk and verification boundary

This is an **input-provenance/compatibility mismatch**, not a recommendation to make the old route executable. A successful legacy task step can have local status/ledger changes before a later commit step fails; the final workflow conclusion may be red even though the task payload succeeded. Conversely a green old run from a different revision does not establish current durable persistence. Never equate `DRY_RUN_OK`, task process exit, workflow conclusion, post-job Git persistence, and runner/platform state.

A separately approved operational remediation should prefer disabling the obsolete workflow or a pre-task fail-closed legacy mode, rather than supplying missing trusted inputs to resurrect the route. A **non-executing** regression can assert that no legacy task invocation reaches executor or local status/ledger mutation. No protected N2 or live manual workflow was used for verification here.

## Authority, learning gate and merge blockers

- Canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; pre-write PR #2286 `4f56e3dc332b396ea0c05f2c4ff738e8b27f82e2` OPEN/Draft. Other open PR #2287 belongs to the LINE lane and is untouched. Recent merged #2284/#2285 provide Forward Vault contract/core, not external K authorization.
- Read latest-main research learning-loop and knowledge-retention contracts, `LEARN-hourly-retrieval-gate-gap-20260918`, `LEARN-github-write-readback-20260918`, and PR `LEARN-research-automation-legacy-task-mode-warning-only-20261030`. Also inspected `EXP-dataset-expand-701398c2`, `DISC-dataset-coverage-701398c2` and the empty main Rejection directory. No existing matching trusted-helper provenance fingerprint was found.
- `fingerprintKey=research-automation.legacy-manual-commit-helper.trusted-input-provenance-gap`; `attemptSignature=pr2286-v475-pinned-legacy-vs-intent-commit-helper-input-provenance-static-audit-no-dispatch`; `environmentKey=github-connector-pinned-main-pr-source/actions-self-hosted-macos-workflow-declaration`; `materialStateKey=legacy-workflow-95094e7/commit-helper-bf7a0dc/intent-workflow-1db7abc`. Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Prior warning-only deprecation learning reused; this distinct mismatch is retained as a new `LEARN-*`.
- Latest pre-write [CI #41068398466](https://github.com/m-shogo/boat-pon/actions/runs/41068398466) **SUCCESS**: 4,671 pass / 2 skip / 0 fail; verify and research-governance jobs and post-job steps passed. CI did **not** execute the legacy workflow, so it does not verify this mismatch dynamically. Nonfatal Node/action deprecations remain.
- K-specific issuer/usage rights, authenticated correction/finality, independent trusted time/revocation, exact payout/refund identity, frozen cohort and approved evaluation protocol remain unverified. Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. No readiness counts inferred.

**Next safe action:** request operational-owner review of obsolete workflow disablement and an explicit fail-closed, non-executing regression. Continue independently attributable K-source primary-evidence review. Keep PR Draft/unmerged and research/production isolation intact.
