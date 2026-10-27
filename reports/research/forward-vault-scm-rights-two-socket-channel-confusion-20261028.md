# Forward Vault: two-socket SCM_RIGHTS channel-claim confusion (synthetic negative control)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: isolated Linux/Python synthetic two-socket application-dispatch negative control. **No real attack, authenticated channel, SDK exploit, independent authority, scoring, recovery or production integration.**

## Authority and learning gate

At the start-of-run authority gate, canonical main was `2342494f6581c167a5648681ca7374b26d6659d4`; the only open PR was [#2286](https://github.com/m-shogo/boat-pon/pull/2286), initially at `89fcae47ce85cfe5bafa81feb482ef0273ba70b4`. Its [official CI #40565542035](https://github.com/m-shogo/boat-pon/actions/runs/40565542035) had completed SUCCESS (verify 4,583 PASS, 2 SKIP, 0 FAIL; governance SUCCESS; post-job cleanup SUCCESS). The active research automation remained enabled; Owner Dashboard work is separately owned. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, merged #2284/#2285, main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` (historical dataset coverage, not handoff authorization), prior SCM_RIGHTS/bootstrap and cross-envelope Learning records, and recent research reports. No relevant new Rejection authority was found.

- `fingerprintKey=research-k3.forward-vault.scm-rights-two-socket-forged-channel-claim`
- `attemptSignature=pr2286-v395-two-socket-queued-forged-claim-route-negative-control`
- `environmentKey=local-linux-node22-python3.13+github-actions-linux-node24-python3`
- `materialStateKey=pr2286-v394-same-peer-object-session-v395-receiver-owned-route-fixture`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reused `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-scm-rights-recvmsg-output-flag-mask-20261028`, `LEARN-forward-vault-pinned-root-late-child-bootstrap-20261027`, `LEARN-forward-v02-cross-envelope-authority-id-replay-20261024` and `LEARN-forward-vault-fd-lifetime-python-newline-fixture-20261028`. This extends an already-known untrusted identity/replay boundary to two actual AF_UNIX socket pairs; it does **not** establish a new independent root cause. Classification: **REUSED_LEARNING**, no filler LEARN record.

## Fixed question and disposable protocol

Can a synthetic receiver misroute a valid directory capability from socket A into an operation intended for socket B when peer identity, directory object, logical session and sender-*claimed* channel all agree?

`src/research/governance/forwardEvaluationVault.scmRightsCrossConnectionLinux.test.ts` uses two real `AF_UNIX/SOCK_DGRAM` socket pairs with a shared synthetic sender process and authorized directory FD. Both senders queue one `SCM_RIGHTS` FD and identical `SESSION_SHARED|CHANNEL_B` bytes **before** either receiver reads; the A-side claim is deliberately forged. No timing, sleeps, mount changes or external listeners are required. Each receiver checks `SO_PEERCRED`, exact one-FD ancillary admission, unexpected flags, `MSG_CMSG_CLOEXEC` noninheritability, and a pre-opened *fixture-only* directory identity. Received descriptors are closed, and the synthetic source file is checked unchanged.

1. **Wrong route, unbound control:** deliberately read from receiver A for an operation meant for B; peer, FD object, session and claimed channel all match, so a route-blind synthetic read succeeds. This is a deliberately vulnerable test policy, not a reported SDK behavior.
2. **Wrong route, bounded denial:** the same A frame is rejected before opening any payload because the receiver-owned socket route is not B.
3. **Correct route, bounded acceptance:** read from receiver B and accept the same otherwise-valid synthetic capability and session once.

The receiver-owned route in this test is a local object/FD identity *assumption*, not an authenticated cross-process channel registry or durable trust root. A sender-provided channel label is forgeable and must not substitute for it.

## Observations, falsifiers and limits

Local Linux Node 22.16.0/Python 3.13.5: **3/3 PASS**, with markers `FORGED_CHANNEL_CLAIM_UNBOUND_ACCEPTED`, `WRONG_SOCKET_REJECTED_BEFORE_READ`, `CORRECT_SOCKET_ACCEPTED`. The exact local and GitHub-read-back Git blob SHA is `095327e63473223d76efaf634f7174225a0b2cbe`; test commit [`8f5dcfb754ad`](https://github.com/m-shogo/boat-pon/commit/8f5dcfb754adb80093e357f26f7f43624504f6e7). Official [test-head CI #40574835903](https://github.com/m-shogo/boat-pon/actions/runs/40574835903) must be checked for a completed conclusion; local tests do not imply CI success.

Falsifiers: a denied wrong-route case reading the payload, an accepted B route referring to A's socket, mismatched peer/directory/FD admission, unexpected ancillary flags, inheritable received FD, altered source bytes, or failed official CI.

**Interpretation:** the kernel isolates the two socket queues; the demonstrated risk is **application-level receiver dispatch or capability-context confusion**, not an AF_UNIX kernel cross-delivery bug. The intentionally forged label is not a real authenticated nonce, and the test does not model independent adversarial processes, credentials across trust domains, concurrent threads, a signed channel binding, real settlement, power loss, mount namespace changes, safe recovery or production behavior. No readiness counts or production authority can be inferred.

## Blockers and next safe action

Still missing: independently authorized sender and directory bootstrap, reviewed receiver-owned channel/session lifecycle and cross-process identity, mount/rename and FD lifetime safety, power-loss durability, safe recovery, independent witness and settlement correction completeness, trusted clock/revocation, frozen prospective cohort and approved v0.2 evaluation protocol.

Next: require an independently specified authenticated channel/capability binding contract before building a deployable handoff; otherwise audit the existing synthetic negative-case coverage for duplicated policy assumptions. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2, private raw T-5 odds, native production bridge, scoring or automatic recovery was touched. **Do not merge** on the strength of this test or green CI.
