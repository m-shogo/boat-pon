# Forward Vault: SCM_RIGHTS pre-handoff FD ownership on frame rejection (research fixture)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: source-level research-test audit plus disposable Linux/Python synthetic reproduction. **Not a production SDK defect, real attack, independently authenticated handoff, scoring, recovery or readiness result.**

## Authority and prior learning

Canonical main at the gate: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286) at `0896ac2bba49634c42c26e9f3bbdaf0a85d1e552` before this slice. Latest pre-change [CI #40574925688](https://github.com/m-shogo/boat-pon/actions/runs/40574925688) completed SUCCESS, verify 4,586 PASS / 2 SKIP / 0 FAIL, governance SUCCESS, cleanup SUCCESS. The hourly research automation is enabled; Owner Dashboard is separately owned. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, merged #2284/#2285, main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` (historical dataset lineage only, **not** capability authority), and main Rejection registry (`.gitkeep` only). Reviewed prior Linux FD lifetime, SCM_RIGHTS admission/output flag and pinned-root bootstrap LEARN records and v393–v395 reports.

- `fingerprintKey=research-k3.forward-vault.scm-rights-prehandoff-rejection-fd-ownership-gap`
- `attemptSignature=pr2286-v396-disposable-receiver-prehandoff-frame-mismatch-ebadf-regression`
- `environmentKey=local-linux-python3.13-node22+github-actions-linux-node24-python3`
- `materialStateKey=pr2286-v395-two-socket-helper-caller-finally-only-v396-receive-local-fd-finally`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Prior `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-scm-rights-recvmsg-output-flag-mask-20261028`, `LEARN-forward-vault-closed-dirfd-number-reuse-20261028`, and `LEARN-forward-vault-fd-lifetime-python-newline-fixture-20261028` informed the change. The specific failure is **exception before caller ownership handoff**, rather than ordinary caller-side close-on-reject.

## Fixed question, observation and correction

Does the research-only two-socket `receive()` fixture close a received descriptor when validation throws **after** `recvmsg` installs it but **before** the helper returns it to the caller?

Before this change, `receive()` appended received SCM_RIGHTS FDs to a local list, then asserted flags, count, identity and payload. The caller's `finally: os.close(fd)` began only after `fd = receive(chosen)` returned successfully. An invalid expected payload could raise inside the helper, bypassing caller cleanup. A minimal isolated Linux `socketpair/sendmsg/recvmsg` reproduction deliberately triggered that assertion and observed that `os.fstat(received_fd)` **still succeeded after rejection while the process remained alive**; its test-only FD was then explicitly closed. This is a research fixture ownership gap, not a demonstrated production leak.

The patch to `src/research/governance/forwardEvaluationVault.scmRightsCrossConnectionLinux.test.ts` introduces a receive-local `admitted` ownership flag and `finally` cleanup for parsed descriptors on every pre-return failure. The added `rejected-frame-close` test sends a synthetic FD over the A socket, intentionally supplies a mismatched expected frame, verifies zero payload reads, exactly one received descriptor, and `EBADF` on `fstat` **before the process exits**. The existing wrong-route negative control, correct-route acceptance and source-file immutability assertions remain.

Code commit: [`87834c250b378197307b7cf14b7e1e0ff70a1892`](https://github.com/m-shogo/boat-pon/commit/87834c250b378197307b7cf14b7e1e0ff70a1892). New regression and old controls require a completed official CI conclusion; the code-head run is [#40582562002](https://github.com/m-shogo/boat-pon/actions/runs/40582562002). Do not infer success while it is pending.

## Falsifiers, boundaries and next step

Falsifiers: mismatched frame admitted; any payload read on rejection; a rejected received FD remaining live; existing 3 socket-routing controls changing behavior; red TypeScript/tests/governance/isolation; or incomplete post-job cleanup. The fixture does not establish independently authenticated peer/channel/directory identity, mount namespace reachability, FD ownership in a real service, power-loss durability, safe recovery, trusted witness/settlement finality, clock/revocation, prospective cohort freeze or an approved evaluation protocol. No production readiness or merge authority is claimed.

Next safe step: confirm the official code/report/LEARN HEAD CI and source readback, then audit other **research-only** SCM_RIGHTS helper rejection paths for the same pre-handoff ownership boundary without inventing a deployable protocol. Do not activate protected N2, alter Current BUY/LINE/public publishing/automated betting/production settings, touch Owner Dashboard, access private raw T-5 evidence or introduce a native production bridge. **Do not merge.**
