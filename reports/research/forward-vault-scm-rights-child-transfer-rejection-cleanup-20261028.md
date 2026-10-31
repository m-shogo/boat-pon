# Forward Vault: transferred child FD rejection cleanup (research-only)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: bounded source audit and synthetic Linux/Python regression on PR #2286. **No production SDK, independent trust-root, or scoring authority.**

## Authority and learning gate

- Canonical main at write gate: `2342494f6581c167a5648681ca7374b26d6659d4`; open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286), branch `research/forward-vault-atomic-readback`. The research-learning-loop and knowledge-retention contracts were read from latest main.
- Relevant prior LEARN: `LEARN-forward-vault-scm-rights-prehandoff-fd-leak-20261028`, `LEARN-forward-vault-scm-rights-session-premature-handoff-decode-20261028`, `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-scm-session-errno-import-fixture-20261028`. The earlier embedded Python newline and output-flag lessons were also reused.
- The main Experiment `EXP-dataset-expand-701398c2` and Discovery `DISC-dataset-coverage-701398c2` concern a separate dataset inventory, **not** evidence of this synthetic FD result. No relevant Rejection record is present.
- `fingerprintKey=research-k3.forward-vault.scm-rights-child-transfer-rejection-fd-ownership`
- `attemptSignature=pr2286-v398-dirfd-transfer-child-identity-mismatch-live-ebadf-and-positive-parity`
- `environmentKey=github-actions-ubuntu24-node24-python3`
- `materialStateKey=pr2286-v397-dirfdTransferLinux-child-assert-before-close-v398-child-finally-ebadf`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. The pre-return rejection/FD ownership failure class is already recorded. No duplicate LEARN is warranted absent a distinct root cause.

## Bounded audit and concrete change

The prior `forwardEvaluationVault.dirfdTransferLinux.test.ts` child-side `SCM_RIGHTS` receiver called `recvmsg`, validated the received directory FD's identity, read a synthetic file, then called `os.close(received_fd)` on the success path. An assertion or open/read failure before that close could leave the FD open until child process termination. This is **a research test fixture lifecycle gap**, not an observed production defect.

The child now wraps ancillary parsing, identity admission, and any bounded synthetic read in a `try/finally` ownership scope, closes each parsed received FD and checks `fstat -> EBADF` while the process remains alive. The new deterministic `transfer-deny-close` mode supplies a deliberately mismatched expected inode, rejects it before opening `synthetic.json`, verifies cleanup, and emits a distinct result. Existing `transfer` and `exec` modes remain present. No real path, raw odds, or private values are used.

Code commits: [`d1c5b268e37f`](https://github.com/m-shogo/boat-pon/commit/d1c5b268e37fd405203ed25ad5cd8fdcd9f8dc81) and [`809567193b3f`](https://github.com/m-shogo/boat-pon/commit/809567193b3f60597c14b2714dce4d22b2ac5316). The second commit corrects the targeted transfer-child argv and embedded newline literal before interpreting CI. The committed source was fetched again and its exact blob SHA verified as `0ee243bb9947ccd800dc87ce7e3d69ec8f4f1995`.

The related research-only receivers were audited: `scmRightsSessionReplayLinux.test.ts` and `scmRightsCrossConnectionLinux.test.ts` already have receive-local rejection cleanup; `scmRightsDirectoryBindingLinux.test.ts` and `scmRightsAdmissionLinux.test.ts` retain top-level finally cleanup. This audit does **not** establish safety of every native FD consumer or arbitrary malformed ancillary input.

## CI interpretation and falsifiers

The previous PR HEAD [CI #40592602609](https://github.com/m-shogo/boat-pon/actions/runs/40592602609) completed SUCCESS (4,589 PASS / 2 SKIP / 0 FAIL). The new code-head [CI #40599797207](https://github.com/m-shogo/boat-pon/actions/runs/40599797207) was started; **its final result must be checked separately** before calling this new test verified.

Five earlier red PR workflows (#40591990631, #40592048397, #40592345330, #40592468640, #40592493798) had full verify/governance job logs reviewed. Research payload failures were the already-recorded embedded Python `errno` NameError (1–2 failing new tests); process exit 1 caused verify FAILURE, governance succeeded, checkout post-job cleanup succeeded, and there was no observed runner/platform fault. These failures are **not** evidence of FD cleanup failure or a reason to repeat the unchanged bad fixture.

Falsifiers: the child accepts mismatched identity, reads the payload on denial, leaves the received FD open before exit, regresses the valid transfer or CLOEXEC test, or the new formal CI fails TypeScript, tests, research governance, isolation or cleanup. The check is limited to a synthetic identity fixture; it does not authenticate an independent root, defend against mount replacement, establish crash durability, or authorize merge.

No Current BUY, LINE, automated betting, public publishing, production behavior/settings, Owner Dashboard, protected N2, private raw T-5 odds or private paths were touched. **Next:** inspect final CI and only pursue additional FD lifecycle work if a distinct untested failure mode is evidenced; otherwise prioritize independently approved trust/clock/finality/protocol contracts.
