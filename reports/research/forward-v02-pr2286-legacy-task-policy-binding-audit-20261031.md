# Forward Vault v0.2 — deprecated task policy-binding and dependency audit (2026-10-31 JST)

**Disposition: NEW_FAILURE (latent static governance-contract mismatch); ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This report is a research-only source comparison. No legacy workflow dispatch, protected N2 activation, task execution, runner access, Current BUY, LINE, publishing, betting, production configuration, Owner Dashboard, private raw evidence or private paths were involved.

## Question and method

Does the deprecated request-file runner bind the selected task's declared safety level and prerequisite status to the request before a task can be claimed, as the canonical intent path does?

This is a distinct check from v472 warning-only deprecation and v475 trusted commit-helper provenance. Pin the current canonical main and PR HEAD, compare task selection, policy checks, catalog/queue definitions and canonical intent guards; do not execute the legacy path.

## Pinned evidence

| Source | Blob SHA | Static observation |
| --- | --- | --- |
| `scripts/run-research-task.ts` | `cce9559ea4cb` | Request safety is checked with `decideSafety(request.safetyLevel, policy)` at lines 187–188; selected task at 208–217 is checked for `READY` only, then resolved at 219–248. No selected-task safety comparison or dependency check occurs between selection and claim. |
| `src/automation/researchOrchestrator.ts` | `d912c611b966` | `validateRequest` validates the request safety field and digest; `preflight` validates authority, queue digest, replay, WAL, disk and working tree. Neither receives selected-task safety/dependency metadata. |
| `automation/task-queue.json` | `997c8769b150` | The pinned **deprecated, non-authoritative** main queue contains three tasks, all with status `PASS`, and therefore no `READY` task in this snapshot. One task is classified `L2`. This is not a live automation-branch readiness statement. |
| `automation/task-catalog.json` | `4d8613e85746` | Canonical catalog includes per-task safety classification and dependencies. Its default statuses are definitions, **not** proof of current execution eligibility. |
| `src/automation/dispatchIntent.ts` | `083878927f18` | `buildCanonicalRequest` explicitly rejects intent safety below catalog task safety (lines 117–121). |
| `scripts/run-intent-task.ts` | `7ea606addaff` | Canonical intent runner checks `staleDefinition`, `READY` and all task dependencies before executor resolution (lines 244–248). |
| `scripts/guard-intent-push.ts` | `7d280f8f29da` | Canonical guard checks READY/dependencies and calls the canonical request builder. |
| `.github/workflows/boat-pon-local-research.yml` | `95094e766434` | Owner/main-guarded legacy manual workflow still declares a task-mode command; GitHub's current enabled/disabled workflow state and runner availability were not independently retrieved. |

## Finding and scope

The deprecated runner checks **request-level** L0/L1/L2 permission and **queue-level** READY status, but does not require `request.safetyLevel >= task.safetyLevel` or verify the selected task's dependencies. If a future or modified legacy queue contains a READY task whose catalog safety is higher than the supplied request safety, or whose prerequisites have not passed, the legacy code has no corresponding task-specific gate before its allowlisted executor call. This is **conditional source reachability**, not an observed task execution or a demonstrated bypass of an active protected N2 gate.

Important limiting evidence: the pinned deprecated main queue is explicitly marked non-authoritative/frozen and has no READY entries. A normal checkout of this snapshot would encounter `TASK_NOT_READY` for those entries, assuming no intervening mutation. The canonical intent path already has both checks. The L3/L4 denial and owner/main/authority/replay preflight are separate safeguards and are not claimed bypassed.

A legacy `dry-run` or `status-only` exits before task selection, so it does not exercise or prove the missing task-level guard. Existing successful CI is also not a dynamic test of this legacy branch. No attempt was made to make the queue READY, activate N2, dispatch the workflow or inspect private runner state.

## Learning and falsification

- Latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md` read; reused `LEARN-research-automation-legacy-task-mode-warning-only-20261030` and `LEARN-research-automation-legacy-commit-helper-provenance-20261031`. Historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` do not authorize this route; main Rejections contain no substantive record.
- `fingerprintKey=research-automation.legacy-task-mode.task-policy-binding-omission`; `attemptSignature=pr2286-v476-pinned-legacy-vs-intent-task-safety-dependency-static-comparison-no-execution`; `environmentKey=github-connector-pinned-main-and-pr-source/no-dispatch/no-runner-access`; `materialStateKey=legacy-runner-cce9559/orchestrator-d912c61/queue-997c876/catalog-4d8613e/intent-runner-7ea606a/intent-builder-0838789`. Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**; not a repeat of v472/v475.
- Before write: canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; PR #2286 `370427e68d9df5c415d86ff17cc6df8cebf23586`, OPEN/Draft; separate LINE PR #2287 untouched. Prior official [CI #41077134867](https://github.com/m-shogo/boat-pon/actions/runs/41077134867) SUCCESS (4,671 pass / 2 skip / 0 fail); verify and governance jobs/post-job steps succeeded. It does **not** establish legacy task safety.
- Falsification: a reviewed code change that fail-closes deprecated `task` before request/queue mutation, or independently verified workflow deactivation, would eliminate the alternate route; a separately approved non-executing test could prove the early exit. Do not test by activating a protected task.
- No K-specific issuer/rights, authenticated correction/finality, independent time/revocation, exact settlement/refund identity, frozen cohort or approved evaluation protocol was established. `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`.

**Next safe action:** operational owner to decide deactivation or pre-task fail-closed enforcement in a separate approved change. Research should verify the guard using non-executing static/unit tests only after authorization. Keep PR Draft/unmerged and avoid repeated equivalent static audits.
