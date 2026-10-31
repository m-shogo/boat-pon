# Forward Vault v0.2 — deprecated request-file task fail-closed remediation (2026-10-31 JST)

**Disposition: VERIFIED_SUCCESS (research automation safety guardrail); ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a change to a deprecated *research* task CLI on Draft PR #2286 only. It does not authorize or perform a workflow dispatch, protected N2 execution, Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard work, private raw T-5 odds access or secret/private-path access.

## Question, learning gate and decision

Prior append-only `LEARN-research-automation-legacy-task-mode-warning-only-20261030` established that the deprecated `task` mode printed a warning but could continue into request parsing, preflight, queue claim and allowlisted executor resolution. Later `LEARN-research-automation-legacy-task-policy-binding-20261031` identified missing selected-task safety/dependency checks, and `LEARN-research-automation-legacy-commit-helper-provenance-20261031` identified a separate post-task persistence mismatch. The highest-value safe response is to **remove reachability**, not to repair the deprecated route into an executable alternate scheduler.

Learning gate: `REUSE_GUARDRAIL / PROCEED_DISTINCT` — reuse the documented fail-closed terminal-exit recommendation, change the relevant material state, and verify with a non-executing no-request CLI regression. No protected N2 or real task request was used.

- `fingerprintKey=research-automation.legacy-task-mode.warning-only-deprecation`
- `attemptSignature=pr2286-v477-early-exit-before-request-parse-and-no-request-cli-regression`
- `environmentKey=github-actions-ubuntu-node24/no-request-cli-regression`
- `materialStateKey=legacy-runner-b33083d/legacy-task-test-8a44b6a`

## Concrete changes

1. [Code `0d4d552b`](https://github.com/m-shogo/boat-pon/commit/0d4d552b18fbcf9d3dbc2f2e0a114fe1fd334d6f) changes `scripts/run-research-task.ts` blob `cce9559` → `b33083d`. When `mode === "task"`, the CLI now prints `DEPRECATED_DISABLED` and exits **3** before request parsing, lock acquisition, status/outcome writes, queue claims or executor resolution. Canonical `automation:intent-task` is a separate script and remains unchanged. Read-only policy loading occurs earlier; do not claim zero file reads.
2. [Regression `5ed205a4`](https://github.com/m-shogo/boat-pon/commit/5ed205a4a111c1ff44e04e2b4387d7c465bd04ca) adds `src/automation/legacyRunnerTaskDisabled.test.ts`: a source-order assertion and a Node 24 no-request CLI process assertion (exit 3 and the disabled marker). The test never submits a request, touches private data, dispatches a workflow or activates N2.
3. [Fixture correction `944ba537`](https://github.com/m-shogo/boat-pon/commit/944ba5370f8ab0c29df57920d1508821c177cb2b) replaces an incorrectly double-escaped JavaScript regular-expression assertion with a literal string assertion. This is a test-fixture error, not a failure of the task-mode guard.

All 13 main workflow YAML files were inspected for direct `automation:task`/`run-research-task` calls. The only direct workflow call found is the legacy `.github/workflows/boat-pon-local-research.yml` at its `Run exactly one task` step. The canonical intent runner and workflow are not changed. This finite static inventory is not proof of every possible indirect caller.

## Official CI and failure-layer separation

- Intermediate [Actions #41095409595](https://github.com/m-shogo/boat-pon/actions/runs/41095409595) for code-only HEAD: SUCCESS.
- Intermediate [Actions #41095449080](https://github.com/m-shogo/boat-pon/actions/runs/41095449080) for the first test commit: **FAILURE**. Full verify job log shows 4,672 PASS / 1 FAIL / 2 SKIP (4,675 total). The new source-order assertion used a double-escaped regex that did not match the actual `process.exit(3);` source; the no-request CLI regression passed. Test process exited 1; verify job and workflow were red. Research-governance job passed, checkout post-job cleanup succeeded, no runner/platform failure was evidenced. The assertion method was corrected; the identical failure was not rerun.
- Corrected [Actions #41095489946](https://github.com/m-shogo/boat-pon/actions/runs/41095489946): **SUCCESS**. Full verify job log confirms 4,673 PASS / 2 SKIP / 0 FAIL (4,675 total), including the no-request exit-3 regression. Typecheck, Test, golden replay, rollout readiness, Build, product/public and BUY/LINE boundaries passed. Research governance, learning checks, secret scan, research/production isolation and post-job cleanup passed. Node 20 action deprecation warning remains nonfatal.

## Remaining boundaries, falsification and next decision

The legacy workflow still declares `workflow_dispatch`; its current GitHub enabled/disabled state and self-hosted runner availability were not independently established. If invoked, its validation/status/post-task steps may still run; this change specifically prevents the deprecated `task` executor path. The legacy post-task commit-helper provenance mismatch remains and must not be "fixed" by making the old route runnable. An operational owner may separately approve workflow disablement. Any future removal or bypass of the early exit should fail the regression; a reviewed change to the canonical intent path is a separate authority decision.

K-specific issuer/usage rights, authenticated inclusive correction and finality, independent time/key/revocation, exact settlement/refund/void identity, frozen prospective cohort and approved evaluation protocol remain unverified. No readiness counts are inferred. `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`; PR stays Draft and unmerged.

**Next safe action:** keep the deprecated CLI disabled and ask the operational owner to review legacy workflow disablement; separately pursue independently attributable K-source primary evidence. Avoid re-running the old task or treating synthetic CI as scoring authority.
