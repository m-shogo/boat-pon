# Forward Vault v0.2 — PR #2286 legacy CLI scope-exception review (2026-11-01 JST)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Read-only GitHub changed-file and patch audit, retained as a research governance finding. No legacy task, protected N2, Current BUY, LINE, public publishing, automated betting, production setting, private archive, raw odds, credential or private filesystem path was accessed or changed by this review.

## Distinct question and observed scope

The earlier [2026-10-30 research scope snapshot](forward-v02-pr2286-research-scope-and-review-gate-20261030.md) correctly counted 364 changed files at that earlier HEAD, all within four research/governance subtrees. **That inventory is no longer an adequate description of the current Draft.** The paginated changed-filename API at HEAD `07e907a112369df0267c552b9e5b4da722e7e113` returned **413 changed paths**:

| Current top-level subtree | Changed paths | Review boundary |
| --- | ---: | --- |
| `config/research-governance/` | 5 | Research schema/config |
| `reports/research/` | 92 | Research governance reports |
| `research/` | 192 | Append-only research artifacts and registries |
| `src/research/` | 122 | Research implementation and tests |
| `scripts/run-research-task.ts` | 1 | **Legacy CLI executable: explicit scope exception** |
| `src/automation/legacyRunnerTaskDisabled.test.ts` | 1 | **Automation-adjacent test: explicit scope exception** |
| **Total** | **413** | **411 research-scoped + 2 separately reviewable exceptions** |

The separate open PR #2287 has 30 changed paths, and **zero filename overlap** with #2286 at this snapshot. #2287 owns LINE readability/miss-review work; do not modify or merge it from the research lane.

## Exact legacy CLI patch finding

The GitHub PR file patch for `scripts/run-research-task.ts` shows three changes, all on the Draft branch, **not canonical main**:

1. Replace eager value import of `resolveExecutor` with a type-only import, and move the value import into the existing legacy execution branch after request handling.
2. Add an early `task` positional-mode exit 3 with `DEPRECATED_DISABLED`, before legacy policy or request-file reads.
3. Add an explicit positional-mode allowlist and early exit 3 for unknown modes with `UNSUPPORTED_MODE`.

The new `src/automation/legacyRunnerTaskDisabled.test.ts` asserts source ordering and launches **only absent-request synthetic CLI cases**, including an isolated empty workspace. It does not run a valid legacy task, prove live workflow disablement, or authorize N2. The code is intended to fail closed, but **an executable CLI changed outside `src/research/` is still an integration-sensitive exception**. Filename classification and successful synthetic tests cannot establish every external invocation path, workflow effect, or compatibility consequence.

**Review requirement before any merge proposal:** separately review the exact CLI patch against canonical intent dispatch, documented legacy callers, workflow references and side-effect boundaries; confirm that no production/BUY/LINE path consumes this script and that the intended deprecation policy is approved. Do not invoke legacy `task` with a valid request, enable protected N2, or change production behavior to obtain this evidence. If independent review cannot establish that scope, keep the Draft blocked or split the legacy CLI change into an explicitly reviewed owner-approved lane. **No merge or scope exception is approved by this report.**

## CI and layered failure evidence

- Current exact-head [Actions #41218161637](https://github.com/m-shogo/boat-pon/actions/runs/41218161637): **SUCCESS**. Both `verify` and `research-governance` jobs, their production-isolation checks, typecheck/build and post-checkout steps completed successfully. This is CI for HEAD **before this report commit**; it is not proof of live automation disablement or K-data authority.
- Previous red [#41217870601](https://github.com/m-shogo/boat-pon/actions/runs/41217870601) and [#41217988956](https://github.com/m-shogo/boat-pon/actions/runs/41217988956): full logs for all four failed jobs were read. The research test payload passed in the verify jobs, but TypeScript TS2322 in the synthetic Reflect.apply test caused Build and Typecheck **process exit 1** and both workflow conclusions **FAILURE**. Post Checkout succeeded for all four jobs. Runner metadata is present; **no separate runner/platform failure is evidenced**. The fix is already retained as `LEARN-forward-v02-synthetic-reflect-apply-hook-ts-overload-20261101` and the current HEAD CI is green. Do not retry the unchanged failing test-hook assignment.

## Authority and learning gate

At pre-write gate, canonical `main` was `2342494f6581c167a5648681ca7374b26d6659d4`, Draft PR #2286 was OPEN at `07e907a112369df0267c552b9e5b4da722e7e113`, and #2287 remained separately owned. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, main `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`, and the main Rejection registry (no substantive entry). Recent merged Forward Vault #2284/#2285 are canonical background; neither authorizes this Draft. The historical dataset inventory does not prove prospective K evidence, issuer rights or readiness.

- `fingerprintKey=research-k3.forward-vault.pr2286-legacy-cli-scope-exception-review`
- `attemptSignature=pr2286-v502-paginated-413-file-scope-and-legacy-cli-patch-review`
- `environmentKey=github-connector/pr-file-list+patch+actions-ubuntu-node24-read-only`
- `materialStateKey=pr2286-07e907a1-413-paths-two-automation-adjacent-exceptions-main-2342494f`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reuse `LEARN-research-automation-legacy-unknown-mode-verified-20261031`, `LEARN-research-automation-legacy-lazy-executor-import-verified-20261031` and the existing scope review. Classification: **REUSED_LEARNING / NO_NEW_LEARNING**; this is an updated review checkpoint, not a newly observed execution failure or a new reusable verified remediation, so no duplicate LEARN is created.

**Unchanged external blockers:** attributable K issuer and use rights; independently authenticated full correction/finality and exact ticket/refund evidence; prospective frozen cohort; approved scoring protocol. `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. Do not infer readiness counts or merge authority. Next safe action is an independent, non-executing review of the two scope exceptions and an attributable K-provider rights/specification response through an approved human route.
