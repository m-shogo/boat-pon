# Forward Vault v0.2 — legacy CLI unknown-mode fallthrough remediation (2026-10-31 JST)

**Disposition: NEW_FAILURE retained; research-only Draft PR #2286; ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This report records a static control-flow finding and a guarded change on the research branch. It is not a workflow dispatch, a successful N2 execution, an external K-data authority check, or production approval.

## Question, authority and learning gate

Question: after v477 disabled the literal `task` mode, can a different positional subcommand still reach the deprecated request-file executor?

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4` (unchanged); PR #2286 is Draft, unmerged.
- Source authority before remediation: `scripts/run-research-task.ts` blob `b33083d76ac7b8674223b38b4c0ee844afb2d5bf` on PR #2286.
- Prior Learning: `LEARN-research-automation-legacy-task-fail-closed-verified-20261031` (`REUSE_VERIFIED_GUARDRAIL` for the exact `task` mode) plus the earlier warning-only and task-policy-binding findings. No identical unknown-mode fingerprint was found in the reviewed Learning inventory.
- Normalized `fingerprintKey=research-automation.legacy-task-mode.unknown-subcommand-fallthrough`; `attemptSignature=pr2286-v478-unknown-subcommand-allowlist-before-request-parse`; `environmentKey=github-connector-pinned-pr-source/github-actions-ubuntu-node24-no-request-cli`; `materialStateKey=legacy-runner-b33083d/unknown-mode-falls-through-task-guard`.
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`; do not repeat the prior `task`-only deprecation audit.

## Static finding and bounded remediation

The old CLI parsed the first positional argument as `mode`. In v477, `mode === "task"` exited 3, but other unknown strings did not match that guard. Only `mode === "validate-request"` exited after validation; with any other unrecognized mode and a syntactically valid request, control flow could proceed through legacy preflight, task selection, and executor resolution. This is a conditional static reachability finding, **not** evidence that any unknown-mode request, executor or protected N2 was run.

[Fix `95310ffb`](https://github.com/m-shogo/boat-pon/commit/95310ffb2a8b67c1edb78df91a56cac57f7c742a) now exits 3 with `UNSUPPORTED_MODE` for every mode other than the explicitly supported `validate-request`, after the earlier `task` denial and before request-file parsing. Existing `status`, `pause`, `resume`, `emergency-stop`, and `clear-emergency-stop` commands retain their pre-existing early branches. Canonical `run-intent-task.ts` is unchanged. Policy/config reads occur before the gate; do not claim zero reads.

[Regression `ea92faae`](https://github.com/m-shogo/boat-pon/commit/ea92faaeca1ed23072980bed9f7c072dd32f9899) adds source-order assertions and three synthetic, deliberately absent-request subprocess invocations (`run-task`, `execute`, `TASK`). They require exit 3 and the `UNSUPPORTED_MODE` marker, and reject a missing-file error. No valid request is supplied; no workflow, queue, executor, N2 or private evidence is touched by this test.

The distinct `NEW_FAILURE` is retained append-only in `research/registries/learnings/LEARN-research-automation-legacy-unknown-mode-fallthrough-20261031.json` ([commit `66637138`](https://github.com/m-shogo/boat-pon/commit/6663713877a0fac0ca264b759356516cefe9b07b), canonical-v2 digest `71403b6d777c511e2a1f0e36a1fc9d29feb0e586938a6db431602df46e7ed26a`).

## Verification boundary and falsification

At the time this report was authored, the official Actions run for the test-bearing commit [#41103667464](https://github.com/m-shogo/boat-pon/actions/runs/41103667464) was **QUEUED**; do not label the new regression verified or CI green until the completed workflow and relevant logs are read. The previous HEAD [#41096422460](https://github.com/m-shogo/boat-pon/actions/runs/41096422460) succeeded, but predates this unknown-mode fix. A completed regression must confirm exit 3, no request parse, typecheck/build, governance digest and research/production isolation; inspect full logs if any job is red and separate payload, process, workflow, post-job and runner causes.

Falsification: removal or movement of the unknown-mode gate after request parsing, an unexpected non-3 exit, or a missing-file read on any synthetic alias should fail the regression. A syntactically valid legacy request must **not** be dispatched merely to demonstrate the bug. The unmerged Draft branch does not protect canonical main; the legacy manual workflow still declares `workflow_dispatch` in main, and its live enablement/self-hosted runner state is not established by this report.

## External blockers and next safe action

The Forward Vault candidate still lacks independently attributable K-specific publisher/usage rights, authenticated inclusive correction/finality, independent time/key/revocation evidence, exact settlement/refund/void identity, frozen prospective cohort and approved scoring protocol. Preserve `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. Do not merge this large research PR or infer readiness from synthetic CI.

**Next:** inspect official CI for the current PR HEAD, correct any concrete regression without repeating unchanged failed attempts, and keep the old CLI fail-closed. Separately seek owner-approved legacy workflow deactivation and K-source primary evidence. Do not touch Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2, private odds, private paths or secrets.
