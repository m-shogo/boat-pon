# Forward Vault: same-peer, same-directory SCM_RIGHTS logical-session replay

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: isolated Linux/Python synthetic logical-session negative control; **no authenticated challenge, real cross-connection attack, independent source authority, scoring or production integration**.

## Authority and learning gate

At start-of-run: canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286), initially `5986ea854ad4de11d9e875af6bbb2832181eb69a`; prior official [CI #40555589023](https://github.com/m-shogo/boat-pon/actions/runs/40555589023) verify/research-governance SUCCESS. The active hourly research automation remains enabled and Owner Dashboard work is separately owned. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, main Experiment `EXP-dataset-expand-701398c2`, Discovery `DISC-dataset-coverage-701398c2`, empty main Rejection registry, recent merged research PR history, and relevant unmerged Linux SCM_RIGHTS, bootstrap and v0.2 cross-envelope replay LEARN records.

- `fingerprintKey=research-k3.forward-vault.scm-rights-same-object-logical-session-replay`
- `attemptSignature=pr2286-v394-same-peer-same-directory-stale-and-duplicate-logical-session-negative-controls`
- `environmentKey=local-linux-python3+github-actions-linux-node24-python3`
- `materialStateKey=pr2286-v393-peer-object-binding-v394-logical-session-freshness-fixture`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reused `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-scm-rights-recvmsg-output-flag-mask-20261028`, `LEARN-forward-vault-pinned-root-late-child-bootstrap-20261027`, `LEARN-forward-v02-cross-envelope-authority-id-replay-20261024` and the embedded-Python newline escaping guardrail. This tests a distinct application-level session dimension of an already-known replay class; no new independent root cause or filler LEARN is claimed.

## Frozen synthetic protocol

`src/research/governance/forwardEvaluationVault.scmRightsSessionReplayLinux.test.ts` runs four bounded Linux/Python modes, each in a disposable temp directory. The same process, UNIX socket pair and authorized directory FD object are used in all modes; `SO_PEERCRED`, `fstat(st_dev,st_ino)`, received FD count, `MSG_CMSG_CLOEXEC`, returned flag mask and FD noninheritability all pass. The synthetic `SESSION_A`/`SESSION_B` strings are deliberately fixed and untrusted: **they are not cryptographic challenges, authenticated session binding or a deployable protocol**.

1. **Stale unbound negative control:** receiver expects a new logical session but ignores the label; an old `SESSION_A` frame carrying the correct directory FD still permits a bounded synthetic read.
2. **Stale guarded denial:** the same old frame is rejected against expected `SESSION_B` before opening any file.
3. **Current guarded acceptance:** a fresh, unconsumed fixture `SESSION_B` frame and the same directory object permit one bounded read.
4. **Duplicate guarded denial:** the first `SESSION_B` frame is consumed; a second identical frame with the same valid directory FD is rejected before any second read.

Every received FD is closed on both admission and rejection; original synthetic bytes are asserted unchanged. No real evidence, mount changes, native SDK bridge, external listener, recovery, or production behavior is involved.

## Observations, falsifiers, limitations

Local isolated Python execution: **4 modes PASS / 0 FAIL**; expected markers `STALE_SESSION_UNBOUND_ACCEPTED`, `STALE_SESSION_REJECTED_BEFORE_READ`, `CURRENT_SESSION_ACCEPTED`, and `DUPLICATE_SESSION_REJECTED_BEFORE_SECOND_READ`. Source commit [`cc84eff6ad270b72e3721fdc1504cc8005946882`](https://github.com/m-shogo/boat-pon/commit/cc84eff6ad270b72e3721fdc1504cc8005946882); GitHub test blob `e0121487c3dabf437a44fe063a997743c63552dd`. Official CI for this new commit is a separate requirement; local success alone is not CI success.

Falsifiers: stale or duplicate frame accepted by the guarded fixture, a guarded rejection performing any payload read, wrong peer/directory identity, unexpected ancillary flags, inheritable or leaked received FD, changed synthetic source bytes, or red official CI.

**Interpretation:** matching peer credentials and directory object identity do not encode logical-session freshness. A one-time label comparison is a useful *synthetic* negative control, not an authentication design: fixed labels are forgeable; the fixture does not test cross-process credential authorization, cross-connection race conditions, nonce entropy, adversarial frame mutation, independent directory provenance, namespace/mount invariance, clock/revocation, crash durability, safe recovery, or source finality. No production readiness, scoring or merge authority follows.

## Remaining blockers and next safe action

Independent sender and directory bootstrap authorization, authenticated session lifecycle/replay resistance, mount/rename and FD ownership races, power-loss persistence, recovery, independently sourced witness/settlement correction completeness, trusted clock/revocation, prospective frozen cohort and approved v0.2 protocol remain missing.

Next: audit actual multiple-socket/connection capability confusion with deterministic barriers and **synthetic-only** fixtures if it is distinct from this logical-session negative control; otherwise prioritize external trust-anchor specifications. Do not activate protected N2, connect Current BUY, LINE, public publishing or automated betting, alter production behavior/settings, touch Owner Dashboard, expose private raw T-5 evidence or merge this candidate.
