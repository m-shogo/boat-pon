# Forward Vault: complete-line synchronization for two-writer Linux race probe

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: official GitHub Actions failure triage and research-only test synchronization repair; fixed-head CI pending  
Scope: test harness only; no SDK writer, data recovery, native integration, scoring, production, Owner Dashboard or protected N2 change

## Authority and incident

Canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; open PR #2286. The latest-main learning-loop and knowledge-retention contracts and relevant Linux renameat2/dirfd Learning records were consulted before this distinct fix. Existing `LEARN-forward-vault-linux-renameat2-single-link-20261027` remains the publication guardrail. No same-method failure retry was performed.

[GitHub Actions #40478662996](https://github.com/m-shogo/boat-pon/actions/runs/40478662996), commit `9da943713ddd318690b26e453db4433a90780fd5`, reported **verify FAILURE**, **research-governance SUCCESS**. The new ancestor-symlink negative fixture **passed**. An older two-writer/reader race test failed at `forwardEvaluationVault.renameNoReplaceRaceLinux.test.ts:98` because the losing process's observed stdout was `READY\nRESULT:LOST` without the trailing newline at the moment the assertion ran; the winning process had `READY\nRESULT:WON\n`. The helper had awaited only the prefix `RESULT:`, which is not a complete protocol message. The failure occurred after an incomplete stream chunk, not from an observed second winner, JSON corruption, or a native syscall failure.

## Five-layer interpretation

1. **Research payload:** the new ancestor-symlink fixture passed; the existing two-writer test did not reach its intended fully framed result assertion. No evidence of an actual no-replace publication invariant violation.
2. **Process:** Node test command exited 1; summary **4,559 tests / 4,556 PASS / 1 FAIL / 2 SKIP**.
3. **Workflow:** verify failed, research-governance succeeded; build was not reached after test failure.
4. **Post-job infrastructure:** cleanup and checkout post-job steps ran; no post-job error observed.
5. **Runner/platform:** no evidence of runner failure. Node deprecation warnings were unrelated to the failing assertion.

The previous code-head [CI #40478161256](https://github.com/m-shogo/boat-pon/actions/runs/40478161256) had passed **4,557 / 2 SKIP / 0 FAIL**, including the new ancestor fixture, demonstrating that this is timing-sensitive test orchestration rather than a deterministic new filesystem behavior.

## Distinct method and falsification

The prior helper returned as soon as a stdout chunk contained `RESULT:`. The repair changes `waitFor` to accept a non-global regular expression and awaits a **complete newline-terminated** `RESULT:(WON|LOST|UNSUPPORTED)` line before comparing the exact outputs. It does not retry the unchanged prefix-only synchronization or alter the child process's renameat2 behavior.

- Initial synchronization edit: `d22546b784070ce2a244783f90ea7561da92c1c2`
- Correct literal regex escape in source: `61b2b612de652a1e736f18588140f639f7e76dc6`
- Test: `src/research/governance/forwardEvaluationVault.renameNoReplaceRaceLinux.test.ts`

The fix is falsified if the completed official test still observes a truncated outcome, a second winner, a changed losing stage, a strict readback failure, or a failing runner-independent build. The test remains a disposable Linux/Python3/glibc probe, not a production concurrency guarantee.

## Learning gate

- fingerprintKey: `research-k3.forward-vault.renameat2-race-test-incomplete-stdout-frame`
- attemptSignature: `pr2286-v382-prefix-result-wait-to-complete-line-regex`
- environmentKey: `github-actions-linux-node24-python3-glibc`
- materialStateKey: `pr2286-v381-renameNoReplaceRaceLinux-prefix-wait-v382-complete-line-regex`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`
- Classification if verified: `NEW_FAILURE` for the old test-harness framing assumption, with a durable `LEARN-*` after official CI verification. The CI failure is **not** evidence of a research filesystem publication failure.

## Safety and next action

Verify the fixed HEAD in official CI, then persist the reusable test-orchestration learning. Continue separate read/write namespace and ancestor-rename/mount threat research only. Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 and private raw T-5 data were untouched.
