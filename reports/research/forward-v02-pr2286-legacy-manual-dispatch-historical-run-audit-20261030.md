# Forward Vault v0.2 — legacy manual dispatch historical-run evidence (2026-10-30 JST)

**Disposition: REUSED_LEARNING / NO_NEW_LEARNING; ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Read-only historical Actions investigation. No workflow dispatch, protected N2 activation, private data read, production/BUY/LINE/public/Owner Dashboard modification, or production settings change.

## Question and scope

Following the pinned source-only warning in [legacy task control-flow audit](forward-v02-pr2286-legacy-task-dispatch-control-flow-audit-20261030.md), did GitHub retain any actual manual dispatch for the legacy workflow, and if so did that run execute a research task or only a dry run?

The GitHub Actions repository-run API, filtered by `event=workflow_dispatch` and `per_page=100`, returned `total_count=1` on 2026-10-30. This is a snapshot of currently retrievable runs, **not** a proof that deleted or expired historical runs never existed. The sole returned run was [#30821403218](https://github.com/m-shogo/boat-pon/actions/runs/30821403218), `boat-pon local research (one-shot)`, created 2026-08-03T14:10:07Z (23:10:07 JST), actor `m-shogo`, event `workflow_dispatch`, main head `7f2f370ce24423dbfa376183cbc6a66802edbf75`, completed with workflow conclusion `success`.

## Historical job evidence and boundaries

- `guard` job #91711943948: SUCCESS, including owner/repository/main/event guard step.
- `run-one-task` job #91711965249: SUCCESS. Request builder output and runner log explicitly show `requestedAction: "dry-run"`; the runner reported `result: "DRY_RUN_OK"`; subsequent status output showed `lastAction: "dry-run"` and `lastResult: "DRY_RUN_OK"`.
- The job executed the `automation:task` **CLI step** under the dry-run request. This is **not** evidence that a READY task executor was invoked, that N2 ran, or that a non-dry-run request succeeded. Do not conflate a successful workflow with a successful research payload.
- The always-run `Commit automation results` step succeeded and its log reports a push to the automation branch. Therefore `dry-run` is **not** equivalent to “no repository state was written”; this historical audit cannot determine the full persisted diff or assert an unsafe write.
- The job completed checkout post-step successfully. Nonfatal Node 20 deprecation messages appear in the job log. No runner/platform failure is evidenced for this run.
- The historical workflow blob `cab4f12a458c4b8459db764e6979c7f1851dcdad` differs from the current main workflow blob `95094e7664346a35635c92bb61d3fbd5f021ddd3`; historical CLI blob `ca3e9d06b5082b1758b4389c345aed71eafd4d7c` differs from current main CLI blob `cce9559`. This run **does not** verify current warning-only task-mode behavior or current dispatchability.
- GitHub connector reads of the workflow-definition state endpoint and per-workflow runs endpoint were not supported. The current workflow YAML still declares `workflow_dispatch`, but **current enabled/disabled platform state remains unverified**.

## Interpretation and falsification

This historical run refines the earlier source-only statement: **there is evidence of one successful owner-initiated manual workflow dispatch, specifically a dry-run, not evidence of a real task execution**. Its branch-state persistence is a bounded observation, not proof of protected N2 activation or production impact. A green CI run on the research PR does not validate legacy manual dispatch policy.

To falsify the current risk claim, an approved operational owner would need to establish that the present workflow is disabled at the GitHub Actions platform level, or install a fail-closed terminal guard for deprecated task mode with a non-executing regression. This research PR must not alter the operational workflow or run it for diagnostics.

## Learning gate and authority

Canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; PR #2286 pre-write HEAD `af84daa034d2bae4272e112d7c39c14d90b54b4c`, OPEN/Draft. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; reviewed `LEARN-research-automation-legacy-task-mode-warning-only-20261030`, `LEARN-github-write-readback-20260918`, `LEARN-forward-v02-synthetic-reference-never-authority-20261025`, main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2`, empty main Rejection registry, and recent merged research PR history.

- `fingerprintKey=research-automation.legacy-task-mode.warning-only-deprecation`
- `attemptSignature=pr2286-v473-historical-workflow-dispatch-run-log-evidence-read-only`
- `environmentKey=github-actions-historical-workflow-dispatch-20260803/github-connector-log-read-20261030`
- `materialStateKey=historical-workflow-cab4f12a/historical-cli-ca3e9d06/current-workflow-95094e7/current-cli-cce9559`
- **Gate:** `REUSE_GUARDRAIL / PROCEED_DISTINCT`. Do not repeat the v472 unchanged static control-flow audit. This is distinct historical execution evidence, not a new root-cause class or a non-obvious verified fix; **no new LEARN**.

**External research blockers unchanged:** independent K issuer and usage rights; authenticated correction/finality; independent trusted time/revocation; exact settlement/refund identity; frozen evaluation cohort; approved evaluation protocol. Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`, and PR #2286 Draft. No readiness counts inferred.

**Next safe action:** request operational-owner review of actual workflow enabled state and fail-closed deprecation policy without dispatching it. Independently continue K-specific primary-source authority review; do not promote synthetic or historical workflow evidence to production authorization.
