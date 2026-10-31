# Forward Vault: Linux close-on-exec and cross-process directory-FD transfer lifetime

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: isolated Linux synthetic child-process capability-lifetime probe. No production, scoring, merge or recovery authority.

## Authority and learning gate

Canonical main at start: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286). Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, merged PR #2285, existing `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2`, empty Rejection registry, and relevant directory-FD lifetime, bootstrap, `openat2` and embedded-Python fixture Learning. The experiment/discovery describe separate historical coverage, not authority for this synthetic filesystem experiment. No protected N2 run.

- fingerprintKey: `research-k3.forward-vault.linux-fd-exec-and-scm-rights-transfer-lifetime`
- attemptSignature: `pr2286-v391-disposable-cloexec-explicit-passfds-and-scm-rights-after-close`
- environmentKey: `local-linux-node22-python3+github-actions-linux-node24-python3`
- materialStateKey: `pr2286-v390-live-dup-process-local-lifetime-v391-cross-process-capability-transfer`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reuse `LEARN-forward-vault-closed-dirfd-number-reuse-20261028` and `LEARN-forward-vault-fd-lifetime-python-newline-fixture-20261028`; do not repeat stale numeric-FD use or the incorrect Python escape fixture.

## Fixed question and protocol

What does `O_CLOEXEC` protect across `exec`, how does explicit `pass_fds` change that boundary, and does `SCM_RIGHTS` convey a live directory object to a child after the sender closes its own descriptor?

Research-only regression: `src/research/governance/forwardEvaluationVault.dirfdTransferLinux.test.ts` (commit `3c10cf30febe96432699a838b8914e07495a0e65`). Node invokes a bounded local Python subprocess using only a disposable `authorized` directory and constant synthetic text. Python uses `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`, a local `AF_UNIX` socket pair, `SCM_RIGHTS`, `fstat` and FD-relative `open`. There are no mounts, external sockets, real research evidence, production code paths, SDK writer changes, file deletion recovery or private raw values.

1. **Default exec negative control:** with `close_fds=False` but the directory FD marked `O_CLOEXEC`, the child must observe `EBADF` rather than inheriting the directory FD.
2. **Explicit inheritance control:** `subprocess.run(pass_fds=(fd,))` explicitly grants the descriptor; the child must see the expected `st_dev/st_ino`. This is an explicit capability grant, not a provenance proof.
3. **Cross-process transfer:** send the live FD over `SCM_RIGHTS` to a child that only inherited the local socket. The sender immediately closes its own FD; the receiver must still `fstat` the same directory object and read exact synthetic bytes via `dir_fd`. The original file must remain unchanged.

Child source is embedded with `String.raw` and triple-quoted Python, avoiding the previous newline-escape failure. All subprocess results are awaited to completion with bounded timeouts; unexpected stderr or exit is a test failure. Unsupported platforms/Python are SKIP, not PASS. No readiness counts are inferred.

## Observation, falsifiers and limits

Local Linux Node 22/Python 3.13: **2 PASS / 0 FAIL / 0 SKIP** with `node --experimental-strip-types --test`. GitHub source was read back after commit and its Python raw template and literal newline escapes checked. **Official GitHub Actions latest-head verification was not yet available when this report was authored**; official success must be established from workflow and job logs before classifying a verified reusable result.

Falsifiers: child unexpectedly inherits the `O_CLOEXEC` directory FD without explicit grant, `pass_fds` cannot access the intended object, the receiver loses the directory after sender close, received ancillary data is absent/ambiguous, content differs, or official CI fails. This fixture demonstrates only process capability-lifetime semantics in this environment. It does **not** establish trusted initial directory provenance, recipient authorization, safe FD transfer against malicious peers, namespace reachability, mount safety, power-loss durability, production integration or safe recovery.

**Design guardrail:** do not treat `O_CLOEXEC` as a general prohibition on deliberate FD transfer; `pass_fds` and `SCM_RIGHTS` explicitly confer a live capability. Require an independently authenticated bootstrap, authorized sender/receiver, bounded descriptor ownership, and fail-closed handoff protocol before any real implementation. Never cache a closed numeric FD, infer trusted identity solely from `st_dev/st_ino`, or use path fallback after transfer failure.

Independent witness, complete settlement corrections, trusted clock/revocation, frozen prospective cohort and approved evaluation protocol remain unavailable. **No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2, private raw odds/values/paths, or scoring authority changed.**

**Next safe step:** audit receiver-side ancillary-message rejection, `MSG_CTRUNC`, unexpected multiple FDs and sender authorization as distinct synthetic negative controls; do not implement a production bridge or automatic recovery.
