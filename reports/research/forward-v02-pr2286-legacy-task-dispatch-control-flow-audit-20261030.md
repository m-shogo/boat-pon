# Forward Vault v0.2 — legacy task dispatch control-flow audit (2026-10-30 JST)

**Disposition: NEW_FAILURE (static governance enforcement mismatch); ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a bounded, read-only research audit. No workflow dispatch, protected N2 activation, local/private dataset access, Current BUY/LINE/public/Owner Dashboard modification, or production setting change occurred. The finding is a reachable source-code path under stated preconditions, **not** evidence of a successful historical task run, privilege bypass, or production incident.

## Question and authority

**Question:** Does the deprecated request-file/local-research route actually fail closed before a task executor can be reached, or does it only emit a deprecation message?

**Hypothesis:** The request-file dispatch stub is inert, but the separately retained owner-guarded manual local-research workflow still points at a warning-only legacy CLI mode. A valid non-dry-run request could pass through its preflight and reach an allowlisted executor.

**Pinned evidence:** canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; PR #2286 pre-write HEAD `8f7dbbc225c6d3ef67330f9f0192f426c7809b05` (OPEN/Draft). GitHub file reads established identical blob SHAs on main and PR for the four examined authority files: `boat-pon-local-research.yml` `95094e7`, `scripts/run-research-task.ts` `cce9559`, `package.json` `8b72a00`, `scripts/build-research-request.mjs` `8fdf91c`. Also read current intent workflow and deprecated request-file stub. No executable was invoked.

## Pinned command-to-executor chain

| Source | Observed control flow | Boundary |
| --- | --- | --- |
| `.github/workflows/boat-pon-request-file-dispatch.yml` | A `workflow_dispatch` stub prints a deprecation notice; it does not dispatch the legacy task. | This **one** stub is inert, but does not disable other workflows. |
| `.github/workflows/boat-pon-local-research.yml` | Still declares `workflow_dispatch`; guard requires owner actor, main ref, repository identity and L0–L3. `run-one-task` invokes `pnpm automation:task -- --request=...` on a self-hosted runner after request creation and validation. | Owner-only and preflight gates remain; no assertion that any run passed them. |
| `package.json` | `automation:task` resolves to `tsx scripts/run-research-task.ts task`. | The alias does not route to the canonical intent runner. |
| `scripts/run-research-task.ts` | `mode === "task"` calls `console.error("DEPRECATED: ...")` **without** `throw`, `return` or `process.exit`; execution then validates the request, acquires the lock, evaluates preflight/safety, and—if not dry-run/status-only—selects a READY task and calls its allowlisted executor. | The deprecation warning is **not** a fail-closed terminal guard. |
| `scripts/build-research-request.mjs` | Legacy builder accepts `run-task` and L0/L1/L2 with validated fields; dry-run/status-only are separate actions. | Non-dry-run is representable. L3 is rejected by this builder even though the workflow UI lists it. |
| `.github/workflows/boat-pon-intent-dispatch.yml` | Separate canonical intent path invokes `automation:intent-task` with automation-branch control-state authority. | Documentation of the new path does not itself terminate the legacy path. |

**Finding:** A declaration that the old request-file task mode is frozen is not enforced at the `task` CLI branch. Under a valid owner-initiated manual dispatch, installed runner dependencies, matching authority/queue digest, safety/preflight success, a READY allowlisted task, and a non-dry-run request, the old execution branch remains *statically reachable*. The legacy runner reads `automation/task-queue.json`, whereas the current intent path uses automation-branch control state. This is a **potential dual-authority divergence**, not a measured divergence or proof of unsafe task execution.

**Non-findings:** No evidence of a bypass of actor/main guards, of a non-allowlisted executor, of a successful manual dispatch, or of protected N2 execution. This review does not alter or run the legacy workflow, and does not infer actual runner/platform availability. No external K-data issuer, rights or correction/finality authority was verified.

## Verification, falsification and response boundary

- Static cross-file trace from pinned GitHub source: workflow trigger → runner job → package alias → CLI mode → validated preflight → guarded executor branch. Both main and PR blobs were compared for the four relevant files.
- Prior official PR-head [Actions #41044798607](https://github.com/m-shogo/boat-pon/actions/runs/41044798607) was **SUCCESS**: 4,673 tests (4,671 PASS, 2 SKIP, 0 FAIL); verify and research-governance jobs and post-job steps passed. These tests **did not execute or validate the legacy manual dispatch branch**. Node 20 / punycode / url.parse nonfatal warnings remain.
- Falsification: an independently approved static regression should assert that deprecated `task` mode terminates before any request, queue or executor side effect; a separate workflow-policy review should decide whether the legacy manual workflow is to be disabled. **Neither change is made here** because operational workflow/runner behavior is outside the research-only change authority.
- Existing Learning reused: `LEARN-github-write-readback-20260918` (read back ambiguous writes) and `LEARN-forward-v02-synthetic-reference-never-authority-20261025` (internal consistency is not independent authority). New semantic fingerprint: `research-automation.legacy-task-mode.warning-only-deprecation`; attempt: `pr2286-v472-pinned-manual-workflow-package-cli-task-mode-control-flow-audit-no-dispatch`; environment: `github-connector-pinned-static-source-review/actions-node24-existing-ci`; material state: `legacy-local-workflow-95094e7/runner-cce9559/package-8b72a00/request-builder-8fdf91c`. Gate **PROCEED_DISTINCT / REUSE_GUARDRAIL**; do not repeat unchanged static audit.

## Research and merge gate

The canonical learning/retention contracts were read from main. Existing `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` are historical dataset records, not external K rights or forward readiness. The main Rejection directory contains only `.gitkeep`; merged PRs #2284/#2285 define/implement research vault foundations, not K authorization. The earlier v469/v470/v471 import/effect audits remain limited; this report traces an **indirect workflow command** rather than claiming a whole-repository runtime isolation proof.

**External blockers remain:** K-specific issuer and usage rights; authenticated correction/finality; independent trusted time/revocation; exact settlement/refund linkage; frozen evaluation cohort; approved protocol. Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`, PR #2286 Draft and `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`.

**Next safe action:** ask the owner of operational workflow policy to review the legacy deprecation enforcement and add a fail-closed regression through a separately approved operational change. Research may continue read-only dependency/authority audits; do not dispatch N2 or alter production.
