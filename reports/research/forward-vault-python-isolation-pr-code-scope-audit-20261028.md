# Forward Vault: PR-scoped Python optimization exposure closure audit

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: bounded GitHub-source audit; no new runtime experiment, production authority, provider proof, scoring or readiness count.

## Authority and learning gate

Canonical main at the pre-write authority gate: `2342494f6581c167a5648681ca7374b26d6659d4`. Sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286), pre-write head `8a8ba48d81269aafb372ed7d719b0d3a693eb890`, 474 commits / 281 changed files. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; reviewed the prior Linux fixture isolation audit, `LEARN-forward-vault-scm-python-optimize-assert-oracle-20261028`, related FD/Python fixture lessons, historical Experiment/Discovery inventory, empty substantive Rejection inventory, recent main merges #2284/#2285, and official [CI #40607339190](https://github.com/m-shogo/boat-pon/actions/runs/40607339190).

- `fingerprintKey=research-k3.forward-vault.python-ambient-optimization-pr-scoped-code-audit`
- `attemptSignature=pr2286-v401-review-64-nonlinux-tests-24-nontest-ts-modules-18-linux-fixtures`
- `environmentKey=github-connector-source-audit+github-actions-linux-node24-python3`
- `materialStateKey=pr2286-v400-python-isolation-18-linux-fixtures-and-unreviewed-88-other-ts-files`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reused `LEARN-forward-vault-scm-python-optimize-assert-oracle-20261028`; no new root cause or new LEARN.

## Question, method and observed scope

Question: does the previously documented ambient `PYTHONOPTIMIZE` / Python `assert` oracle risk remain in other TypeScript files changed by PR #2286, outside the 18 Linux fixtures fixed by v399-v400?

Read the current PR changed-file list (281 paths) and fetched the actual PR-head content for **all 64 changed non-Linux `*.test.ts` files** and **all 24 changed non-test `*.ts` modules**. Inspected source lines for Python launchers, `PYTHONOPTIMIZE`, and child-process invocation markers. None of these **88** files contains a matching Python launcher or optimization marker. Three non-Linux tests spawn **Node** subprocesses via `process.execPath`: `forwardEvaluationVault.concurrentPublication.test.ts`, `forwardEvaluationVault.processTermination.test.ts`, and `forwardEvaluationVault.readbackPublicationWindow.test.ts`. These are **not** Python `assert` probes and must not be silently counted as remediated Python cases; Node ambient execution semantics are a separate question.

Separately re-fetched **all 18 PR-changed `forwardEvaluationVault.*Linux.test.ts` files** and inspected explicit Python subprocess launch sites. Their test-execution launchers use `-I` (including `-I -u -c` where unbuffered output is required). Availability-only `python3 --version` checks intentionally do not use `-I`; they do not execute the synthetic assert-based safety oracles. This corroborates the earlier 18-file isolation report rather than establishing a new mechanism. Nested-child isolation was covered by the earlier injected-`PYTHONOPTIMIZE=2` regression, not newly retested here.

The resulting **106-file bounded PR-code scope** contains no newly identified non-isolated Python assertion oracle. This is not a repository-wide guarantee: unchanged files, dynamically constructed invocations, scripts outside these extensions, and unobserved execution environments are not cleared.

## Verification and limitations

Pre-write latest-head official [CI #40607339190](https://github.com/m-shogo/boat-pon/actions/runs/40607339190) completed **SUCCESS**: verify 4,591 PASS / 2 SKIP / 0 FAIL (4,593 total), research-governance SUCCESS, typecheck/build/isolation/secret scan/post-job cleanup SUCCESS. Full verify and governance job logs were inspected for the relevant result layers. No red workflow or runner incident was present in the current latest-head check. This audit is source-only and does **not** add tests or claim a new CI result before the report commit is checked.

Falsifiers: an omitted PR-changed `*.test.ts` or non-test `*.ts` file, a Python launch site in the audited 88 files, an explicit unisolated Python test-execution launcher in the 18 Linux files, a mismatched branch head, or a new-head CI/governance failure. The prior `-I` change does not itself prove independent evidence authentication, FD provenance, or power-loss durability.

## Decision, blockers, and next safe action

**No further Python-isolation code patch justified in this bounded scope.** Preserve the prior Learning guardrail and avoid redundant tests or duplicate Learning records. Next highest-value work is to inspect repository files *outside* the PR-changed TypeScript scope only if a concrete Python launcher or CI symptom is identified; otherwise prioritize the already documented external issuer/provider evidence and protocol gates rather than extending synthetic FD tests.

Independently authenticated issuer/correction completeness/finality, trusted clock and key revocation, prospective frozen cohort, approved v0.2 evaluation protocol, exact settlement/refund semantics, authenticated directory provenance, power-loss persistence and recovery remain **unresolved**. No protected/dormant N2, Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, private raw T-5 odds, secrets or private paths were accessed or modified.

**Learning classification: REUSED_LEARNING**; no new `LEARN-*` (prior cause and guardrail already retained). Research/production isolation remains intact. **DO_NOT_MERGE_CANDIDATE.**
