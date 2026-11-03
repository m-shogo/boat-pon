# Forward Vault v0.2 — legacy unknown-mode guard: official CI verification (2026-10-31 JST)

**Disposition: VERIFIED_SUCCESS for a bounded synthetic CLI regression only.** Draft research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286) remains `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`. This record is not K-data authorization, production authority, an N2 dispatch, or evidence that the legacy workflow is disabled on GitHub.

## Question and pinned authorities

Question: did the explicit unknown-mode deny gate introduced in v478 actually execute in official CI, and did the complete workflow finish without an independent post-job failure?

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4` (unchanged); PR #2286 remains Draft and unmerged.
- Guard implementation: [`95310ffb`](https://github.com/m-shogo/boat-pon/commit/95310ffb2a8b67c1edb78df91a56cac57f7c742a), `scripts/run-research-task.ts` blob `b5274c57410c2aa85ebbc0eeb28955d631d2840c`.
- Regression: [`ea92faae`](https://github.com/m-shogo/boat-pon/commit/ea92faaeca1ed23072980bed9f7c072dd32f9899), `src/automation/legacyRunnerTaskDisabled.test.ts`.
- Prior new-failure record: `LEARN-research-automation-legacy-unknown-mode-fallthrough-20261031`; earlier task-mode verified guardrail: `LEARN-research-automation-legacy-task-fail-closed-verified-20261031`.
- Latest verified run for the exact code/test/report-bearing HEAD `86ff2451f63c684962fe7cd239328712f82f9d11`: [Actions #41103940614](https://github.com/m-shogo/boat-pon/actions/runs/41103940614).

## Observed verification and layer separation

The run completed `success`, with two successful jobs: `verify` (job `124228088395`) and `research-governance` (job `124228089126`). Full logs were inspected, not only summary badges.

- **Research payload:** the named regression `unknown legacy modes are denied before parsing a request or reaching an executor` passed. Its synthetic `run-task`, `execute`, `TASK` subprocess cases require exit 3 and `UNSUPPORTED_MODE`, and do not supply a real request. The earlier `task` denial and source-order tests also passed.
- **Process/test layer:** the verify job recorded **4,676 tests: 4,674 PASS, 2 SKIP, 0 FAIL**. The named regression was executed, not merely compiled. Build, typecheck, replay and isolation checks passed.
- **Workflow layer:** both jobs concluded `success`; research governance and Learning digest validation passed.
- **Post-job layer:** post-setup and post-checkout steps succeeded for both jobs; no separate cleanup failure was observed.
- **Runner/platform:** no runner/platform fault was evidenced. Nonfatal Node 20 action-deprecation and `punycode` warnings remain.

The test intentionally avoids valid legacy request execution. Its result does **not** prove how an arbitrary valid request would behave, nor that a live self-hosted runner or GitHub workflow is disabled.

## Learning gate and durable outcome

- `fingerprintKey=research-automation.legacy-task-mode.unknown-subcommand-fallthrough`
- `attemptSignature=pr2286-v478-unknown-subcommand-allowlist-before-request-parse`
- `environmentKey=github-connector-pinned-pr-source/github-actions-ubuntu-node24-no-request-cli`
- `materialStateKey=legacy-runner-b5274c57/unknown-mode-allowlist-before-request-parse`
- Gate: `PROCEED_DISTINCT` on changed material state, reusing v477 task-mode guardrail; do not rerun the original failure method.
- Result: `VERIFIED_SUCCESS` for this non-obvious guardrail, retained append-only in `research/registries/learnings/LEARN-research-automation-legacy-unknown-mode-verified-20261031.json` ([commit `1851f426`](https://github.com/m-shogo/boat-pon/commit/1851f42666d52a4f98711107a0495646d839f316)), canonical-v2 digest `3e39265727fbf068e643d2ee3458db580ae4cc95aabf1397eb765d53588a4178`.

## Remaining boundary and falsification

The legacy CLI still has intentional early control commands (`status`, `pause`, `resume`, `emergency-stop`, `clear-emergency-stop`) and a `validate-request` path. The new deny gate is after the early commands and after a policy/config read, but before legacy request-file parsing. It does not disable or audit those operator controls. Main's `.github/workflows/boat-pon-local-research.yml` still declares `workflow_dispatch`; live enablement is not established by a YAML read. No workflow was dispatched during this review.

Falsification: if a later change permits unknown modes past the request parse or removes the exit-3 subprocess assertion, this verification must not be reused for the changed material state. The next CI for this report/Learning commit must be checked separately; the prior green run does not certify subsequent changes.

K-specific issuer and usage rights, authenticated correction/finality, independent time/key/revocation witness, exact settlement/refund/void mapping, frozen prospective cohort and approved scoring protocol remain unresolved. Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2, private raw odds, private paths or secrets were accessed or changed.

**Next safe action:** check official CI for the new append-only Learning/report commits; separately request owner/operator review of the deprecated workflow's live state. Prioritize independently attributable K-source evidence over repeated static CLI audits.
