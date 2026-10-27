# Forward Vault: bounded openat2 EAGAIN fail-closed contract (injected adapter error)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
Date: 2026-10-27 JST
Evidence stage: disposable Linux kernel control + **injected** syscall-adapter EAGAIN; official CI verified; **not** a live kernel rename-race reproduction or production authority.

## Authority and learning gate

At start and before the write, canonical main was 2342494f6581c167a5648681ca7374b26d6659d4. The only open PR was research PR #2286; predecessor head dd39541ecdcbdc4037b5d0befd78471871ddcb40 passed official CI #40501217889. The active Boat Pon hourly automation remained enabled. Latest-main docs/architecture/research-learning-loop.md and docs/architecture/research-knowledge-retention-contract.md were read. The prior LEARN-forward-vault-openat2-trust-root-mount-boundaries-20261027, strict-reader race and ancestor-symlink learnings were retrieved; latest-main EXP-dataset-expand-701398c2 / DISC-dataset-coverage-701398c2 were reviewed as unrelated dataset inventory lineage, with no Rejection record on main. Merged PR #2285 provides the unchanged Forward Evaluation Vault core.

- fingerprintKey: research-k3.forward-vault.openat2-eagain-one-attempt-failclosed-contract
- attemptSignature: pr2286-v387-injected-eagain-single-attempt-denial-and-kernel-control
- environmentKey: github-actions-linux-node24-python3-openat2-syscall437
- materialStateKey: executor-sdk-v3/pr2286-v386-openat2-traversal-probe-v387-injected-error-policy-fixture
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reused LEARN-forward-vault-openat2-trust-root-mount-boundaries-20261027 and prior check-to-open race denial boundaries. No unchanged failed method was repeated. This deterministic adapter-injection contract does not warrant a new LEARN record.

## Question and fixed protocol

Question: if a future research-only Linux openat2 reader receives EAGAIN because path resolution is uncertain, can a minimal one-attempt policy deny the read without unbounded retry, weaker pathname fallback, stale-path cleanup, or a misleading identity claim?

File: src/research/governance/forwardEvaluationVault.openat2EagainFailClosedLinux.test.ts; test commit 7ee3700b557fc20b71cb9cec8c057753dbeff014. The test stages a single-link synthetic JSON under a disposable directory. Python ctypes calls syscall 437 on supported Linux x86_64/aarch64 with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV, starting from an already opened root directory FD.

1. Positive kernel control: read the staged JSON through real openat2; check regular-file mode and link count one.
2. Deterministic **adapter injection**: substitute an opener that raises OSError(errno.EAGAIN) on its first invocation. The research-only read_once policy must return INDETERMINATE_DENY, not bytes, and the injected opener's call list must contain **exactly one** attempt with the original flags and root FD. No os.open/pathname fallback is present.
3. Positive kernel control again: read the same original JSON through real openat2, then verify the on-disk bytes and link count are unchanged. Unsupported syscall/architecture is skipped, never counted as verified execution.

The test performs no directory rename, mount operation, production read/write, cleanup of existing artifacts, SDK change, native bridge, or protected N2 execution. It does **not** force the real kernel to emit EAGAIN; the injection is deliberately separated from the kernel success controls.

## Verified result and failure layers

Official [CI #40508805918](https://github.com/m-shogo/boat-pon/actions/runs/40508805918) for commit 7ee3700b557fc20b71cb9cec8c057753dbeff014: **SUCCESS**. Full verify job log explicitly executed and passed "denies injected resolution uncertainty after one attempt without a pathname fallback". Suite totals: **4,566 tests / 4,564 PASS / 2 SKIP / 0 FAIL**. TypeScript check and Vite build completed; Research Governance succeeded, including research-only isolation and integrity checks. All post-job cleanup steps succeeded. Error strings in unrelated negative-input fixtures are expected test output, not a red job or runner incident.

Research payload: one successful kernel-control/injection/kernel-control fixture; process exit zero; verify and governance jobs SUCCESS; post-job infrastructure SUCCESS; no runner/platform failure demonstrated.

## Interpretation, falsifiers, and limits

This is a **verified policy fixture**, not a demonstrated Linux kernel EAGAIN race and not a verified native reader implementation. The injected error is intentionally not treated as a permanent invalid path: the caller-facing classification is indeterminate **and denied**. A future native integration must independently define and review its trust-root lifecycle, common reader/writer directory identity, allowed retry budget (possibly zero), failure semantics, mount/rename concurrency, power-loss durability, and secure recovery. The existing SDK's pathname-based verifyJsonReadback remains unchanged.

Falsifiers: a second injected opener call, accepted bytes after injected EAGAIN, a fallback pathname read, changed file content/link count, an unexecuted/skipped fixture represented as PASS, or red CI/job/cleanup. None occurred in this bounded run.

No independent witness authenticity, terminal correction completeness, trusted clock/revocation, prospective cohort freeze, approved v0.2 scoring protocol, or merge readiness is established. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, dormant/protected N2 activation, private raw T-5 odds, secrets, or private filesystem paths were used or modified.

Next safe step: design a separately bounded **real kernel** concurrent rename/parent traversal experiment that records whether EAGAIN actually occurs without relying on nondeterministic occurrence for CI success. Do not turn an injected policy result into a kernel-race claim, and do not add a native/production bridge or automatic stale-path deletion.
