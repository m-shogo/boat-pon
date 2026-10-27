# Forward Vault: session receiver pre-handoff FD ownership (research-only)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: source audit plus disposable Linux/Python synthetic reproduction. **No production SDK issue, real peer authentication, approved evaluation protocol, or readiness claim.**

## Authority and learning gate

- Latest canonical main at write gate: `2342494f6581c167a5648681ca7374b26d6659d4`; only open PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286), research branch `research/forward-vault-atomic-readback`.
- Latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md` reviewed; merged Forward Vault contract/core PRs #2284/#2285 and main Experiment/Discovery lineage reviewed. Historical dataset registry facts are **not** evidence or authority for this synthetic test. No Rejection record relevant to this FD scope was found.
- Prior Learning reused: `LEARN-forward-vault-scm-rights-prehandoff-fd-leak-20261028` (same exception-before-handoff root cause), `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-scm-rights-recvmsg-output-flag-mask-20261028` and the embedded Python escape guardrail.
- `fingerprintKey=research-k3.forward-vault.scm-rights-session-receiver-prehandoff-ownership`
- `attemptSignature=pr2286-v397-session-receive-prehandoff-mismatch-ebadf-and-current-recovery`
- `environmentKey=local-linux-python3.13-node22+github-actions-linux-node24-python3`
- `materialStateKey=pr2286-v396-cross-connection-receive-local-finally-v397-session-receive-local-finally`
- Learning gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. This is another caller-before-return exposure of the already recorded failure class, not a new independent root cause. No duplicate LEARN is warranted.

## Fixed question and mechanism

The session-replay synthetic fixture in `src/research/governance/forwardEvaluationVault.scmRightsSessionReplayLinux.test.ts` parsed and validated an `SCM_RIGHTS` descriptor in `receive()`, then returned `(frame, fd)`. Each caller used `finally: os.close(fd)` only **after** a successful return. An assertion during pre-return validation would bypass caller cleanup while the received FD remained installed in the receiver. This is a source-level ownership gap in a **research fixture**, not evidence of a production FD leak.

The receiver now owns parsed descriptors until all checks pass, using a receive-local `try/finally` and an explicit `admitted` handoff flag. A deterministic synthetic negative control passes an obsolete frame `SESSION_A` while requiring `SESSION_B` **inside** the helper. It confirms the rejection occurs after FD receipt, no payload read or session consumption occurs, and `os.fstat(rejected_fd)` raises `EBADF` **before process exit**. The same process then accepts a valid `SESSION_B` and reads only the synthetic fixture. Existing stale, current and duplicate-session controls remain unchanged.

Code commit: [`8c8b2464696caf6d8b88aeaaccb91bdbf0a83ce9`](https://github.com/m-shogo/boat-pon/commit/8c8b2464696caf6d8b88aeaaccb91bdbf0a83ce9). Local disposable Linux/Python execution: **5/5 modes exited 0**, including the new rejection-and-recovery mode. GitHub file readback matched the written blob SHA `3c7940b1f99fe9a639e42524a7eb1687b2fa2e37`. The previous official PR HEAD [CI #40582725179](https://github.com/m-shogo/boat-pon/actions/runs/40582725179) was completed SUCCESS (verify/governance/post-job cleanup). The new code-head official CI must be assessed separately; local probe success does not replace CI.

## Falsifiers, limits and next safe step

Falsifiers: a rejected descriptor remains live; a stale frame consumes the current session or reads payload; the valid frame fails after rejection; existing four controls regress; new official CI reports failed test/typecheck/governance/isolation or post-job infrastructure failure. Do not classify a red workflow without full job logs and separate payload, process, workflow, cleanup and runner evidence.

This is **not** a real authenticated protocol: peer, directory identity, channel, freshness, mount namespace, crash durability, trusted witness, finality, revocation and prospective cohort freeze remain unproven. No protected N2 activation, private raw odds, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard or recovery wiring was touched. **Do not merge.**

Next: verify the new official CI and read back this report; inspect other research-only FD receive helpers for the same ownership pattern without creating duplicate fixtures or changing production behavior.

## Addendum: fallible return expression after premature handoff flag

Follow-up source review identified a **distinct** pre-return ownership bug in the first session helper patch: `admitted=True` was set **before** `return payload.decode('ascii'), fd`. Python evaluates the decode before returning, so an invalid byte sequence raised `UnicodeDecodeError` after the cleanup flag had been set. A disposable Linux negative control reproduced a live FD via `fstat` after the error and explicitly closed it. This is a **research-only test fixture defect**, not a production SDK issue.

The follow-up fix [`09ff0dca562c15cb7b35bd3c2e61cfa850280a4f`](https://github.com/m-shogo/boat-pon/commit/09ff0dca562c15cb7b35bd3c2e61cfa850280a4f) decodes the frame **before** setting `admitted=True`, then returns the already-decoded value. The new `nonascii-pre-handoff-reject-close` mode sends `b'\\xff'`, expects `UnicodeDecodeError`, verifies `EBADF` on the received FD while the process is alive, and subsequently accepts the current synthetic session. The original four controls plus the mismatched-frame control and this new control all passed locally (**6/6**).

Because this was a new root-cause variant (premature ownership transfer before a fallible return expression), a separate append-only Learning was recorded: `research/registries/learnings/LEARN-forward-vault-scm-rights-session-premature-handoff-decode-20261028.json`, commit [`259b870a47adba5ff086c811120f5c5ff728c7f0`](https://github.com/m-shogo/boat-pon/commit/259b870a47adba5ff086c811120f5c5ff728c7f0), digest `4c28ac0a5087eba13373608975eb0e160c68c374da4d6e37107c979d17dc80fd`. Its normalized fingerprint is `research-k3.forward-vault.scm-rights-session-premature-ownership-before-decode`; unsafe method is blocked without material change. The earlier pre-handoff Learning still applies to the initial mismatch case. Official CI for the **final** code/LEARN/report HEAD remains a separate requirement; do not infer success from local probes.
