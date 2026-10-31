# Forward Vault v0.2 — legacy dry-run persistence and replay-ledger semantics (2026-10-30 JST)

**Disposition: REUSED_LEARNING / NO_NEW_LEARNING; ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Read-only source and historical-log audit; no workflow dispatch, task executor, protected N2, private dataset, production/BUY/LINE/public/Owner Dashboard change or operational configuration change.

## Question and distinction from prior audit

The [v473 historical manual-dispatch report](forward-v02-pr2286-legacy-manual-dispatch-historical-run-audit-20261030.md) established a single retrievable owner-initiated manual dry-run ([Actions #30821403218](https://github.com/m-shogo/boat-pon/actions/runs/30821403218)) and a successful post-run automation-branch push, but did not identify its exact persisted diff. This audit asks a different question: **what does `DRY_RUN_OK` mean for persistent request identity and replay state in the historical runner versus the current canonical runner?**

## Pinned evidence and observed semantics

| Boundary | Historical workflow revision (2026-08-03, `7f2f370ce244`) | Canonical main (`2342494f6581`) |
| --- | --- | --- |
| Runner identity | `scripts/run-research-task.ts` blob `ca3e9d06b508` | Same path blob `cce9559ea4cb` |
| Dry-run branch | After validation, lock, preflight and safety, `dryRun || status-only` calls `finish("DRY_RUN_OK", 0, ...)` **before** task selection | Same early exit, before READY-task selection and `resolveExecutor` |
| `finish` side effects | Writes `reports/automation/current-status.json` and `.md`, releases lock, exits | Writes status, then calls `recordRequestOutcome`, releases lock, exits |
| Terminal request ledger | Historical `finish` has no `recordRequestOutcome` call | `DRY_RUN_OK` is explicitly terminal and writes `automation/requests/completed/<requestId>.json` |
| Replay read | Historical inspected runner does not show a completed-request registry write in `finish` | Current preflight gathers IDs from `automation/requests/completed` as `alreadyProcessedRequestIds` |
| Post-run Git | Historical `scripts/automation-commit.sh` blob `9d0877c878f0` commits changed allowlisted paths and pushes to the automation branch | Current commit helper has separate hardened CAS/allowlist checks; not executed by this audit |

**Interpretation:** `dry-run` here means **no selected task executor invocation after the dry-run gate**, not **read-only** and not **no durable state**. In the current legacy CLI it additionally consumes a terminal request identity by writing a completed outcome. A later request with the same ID is therefore subject to the replay guard; this is a source-level consequence, **not** evidence that an actual current manual dispatch was performed. `status-only` shares the same `DRY_RUN_OK` branch and terminal ledger semantics.

The 2026-08-03 run's log shows `requestedAction: dry-run`, `DRY_RUN_OK`, successful commit-step completion and `pushed to automation/boat-pon-research`. It does **not** reveal the exact Git commit SHA or changed-file diff. Current branch history and GitHub commit search did not establish a unique historical push commit; do not infer an exact persisted file set from a successful push message.

## Governance implication and falsification

The operator should distinguish three independent claims in future runbooks and dashboards: (1) **executor skipped**, (2) **local status/outcome state mutated**, and (3) **Git branch persistence completed**. `DRY_RUN_OK` alone proves only the first under the inspected branch; a successful workflow/push may support the third without identifying the exact diff.

The legacy task mode still emits a deprecation warning without a terminal exit (existing [v472 control-flow finding](forward-v02-pr2286-legacy-task-dispatch-control-flow-audit-20261030.md)). The manual workflow YAML still declares `workflow_dispatch`; the GitHub Actions **platform enabled/disabled state could not be read** through the available connector and is **not claimed**. The current intent path has separate control-state authority; this audit does not assert that the legacy completed ledger is authoritative for that path.

An independently approved operational change could explicitly fail-close the legacy `task` mode before request/status/ledger side effects, or disable the manual workflow. A non-executing regression should separately assert that a deprecated invocation cannot reach a task executor **and** cannot mutate status or completed-request ledger. This research-only PR neither changes nor executes that workflow/CLI.

## Learning gate and evidence authority

- Canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; pre-write PR #2286 HEAD `0261a6d80d86e4cb2f8b32af238d4ab4def2dc99`, OPEN/Draft.
- Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; relevant `LEARN-research-automation-legacy-task-mode-warning-only-20261030`, `EXP-dataset-expand-701398c2`, `DISC-dataset-coverage-701398c2`, empty Rejection registry and recent merged research PRs. The Experiment/Discovery records do not establish K-data authority.
- `fingerprintKey=research-automation.legacy-task-mode.warning-only-deprecation`
- `attemptSignature=pr2286-v474-historical-vs-current-dry-run-terminal-ledger-source-audit-no-dispatch`
- `environmentKey=github-connector-pinned-source-and-historical-actions-logs-20261030`
- `materialStateKey=historical-runner-ca3e9d06/current-runner-cce9559/historical-commit-helper-9d0877c8`
- Gate `REUSE_GUARDRAIL / PROCEED_DISTINCT`: reuses existing fail-closed deprecation learning; this is a distinct state-semantics comparison, **not** a verified new root-cause class or implemented fix. No new `LEARN-*` created.

Latest pre-write [CI #41060123574](https://github.com/m-shogo/boat-pon/actions/runs/41060123574) was SUCCESS, including verify, research governance, typecheck, build, isolation and post-job steps. No red research workflow was encountered in this audit. CI does not prove GitHub Actions manual-workflow enabled state or authorize production.

**External K-data blockers unchanged:** independently verified issuer/usage rights, authenticated corrections/finality, independent trusted time/revocation, exact settlement/refund identity, frozen cohort and approved evaluation protocol. Preserve `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`; keep PR Draft and `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`. No readiness counts inferred.

**Next safe action:** obtain operational-owner verification of workflow platform state and deprecation policy without dispatch; continue K-specific primary-source authority review and research-only audits.