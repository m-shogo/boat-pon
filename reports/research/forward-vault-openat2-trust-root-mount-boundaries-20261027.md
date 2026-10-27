# Forward Vault: Linux openat2 trust-root, real-ancestor substitution and mount boundaries

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
Date: 2026-10-27 JST
Evidence stage: isolated synthetic Linux regression, official CI verified; **no production, scoring or readiness authority**

## Authority and learning gate

Canonical main at start and before this write: `2342494f6581c167a5648681ca7374b26d6659d4`. Open research PR: #2286 (only open PR); preceding head `cd895ae70a1ac89a964ef033432aa507f240051a`, previous official CI #40493002095 SUCCESS. Current test commit: `4a76bd20dd3ad035abf31dc7c1e1a5c302a508ec`.

Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; retrieved relevant `LEARN-forward-vault-strict-reader-check-open-race-20261027`, `LEARN-forward-vault-dirfd-reachability-preflight-toctou-20261027`, `LEARN-forward-vault-linux-dirfd-parent-swap-20261027`, `LEARN-forward-vault-linux-renameat2-single-link-20261027`; reviewed latest-main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` (unrelated settlement inventory lineage) and merged PR #2285. Existing real-directory rename and pinned-FD limitations were reused, not rediscovered or contradicted.

- fingerprintKey: `research-k3.forward-vault.openat2-rootfd-mount-and-intermediate-rename-boundaries`
- attemptSignature: `pr2286-v386-openat2-rootfd-symlink-escape-mount-and-real-ancestor-swap`
- environmentKey: `github-actions-linux-node24-python3-openat2-syscall437`
- materialStateKey: `executor-sdk-v3/pr2286-v385-path-reader-and-dirfd-probes-v386-openat2-negative-fixtures`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. This tests an additional Linux kernel pathname resolver and an existing mount boundary, not the previously failed preflight-only path identity method.

## Fixed protocol

File: `src/research/governance/forwardEvaluationVault.openat2TrustRootLinux.test.ts`. Python `ctypes` calls Linux `openat2` syscall 437 on x86_64/aarch64 only. The test uses disposable synthetic JSON, regular single-link files, no production records and no mount operations. It skips when the syscall is unavailable/blocked or the existing `/proc` mount is not distinct. All fixtures are removed from their unique disposable test root.

1. With a pinned root FD, `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS` opens the original `anchor/vault/published.json` and rejects an ancestor symlink with `ELOOP` and an escaping `..` path with `EXDEV`.
2. Rename the real `anchor` directory to `moved` and the distinct real `decoy` to `anchor`. The **same root FD** and resolver flags now open valid decoy bytes through the replaced intermediate name, while a **pre-pinned vault FD** still opens original bytes. Both files remain regular, single-link and unchanged.
3. Without creating or changing a mount, open `/proc/version` relative to a `/` FD with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, then verify that adding `RESOLVE_NO_XDEV` refuses the existing mount crossing with `EXDEV`.

## Observed evidence

Official GitHub Actions [CI #40500626997](https://github.com/m-shogo/boat-pon/actions/runs/40500626997) for test commit `4a76bd20dd3ad035abf31dc7c1e1a5c302a508ec`: **SUCCESS**. Full verify log confirms both new named tests executed and **PASS**. Overall **4,565 tests: 4,563 PASS / 2 SKIP / 0 FAIL**. Verify and research-governance jobs succeeded, including typecheck/build, research separation, secret scan and post-job cleanup. Log error text in unrelated negative-input fixtures did not represent a failed job.

The Linux `openat2(2)` manual documents `RESOLVE_NO_SYMLINKS` (all path components), `RESOLVE_BENEATH` (root escape prevention), `RESOLVE_NO_XDEV` (mount/bind-mount traversal prevention), and `EAGAIN` for some concurrent resolution ambiguity: https://man7.org/linux/man-pages/man2/openat2.2.html .

## Interpretation, falsifiers and limits

**Verified bounded guardrail:** `openat2` resolver flags constrain symlink, escape and mount traversal in this environment; they do **not** authenticate the identity of a mutable *real* intermediate directory name. A trusted root FD is not equivalent to a pinned final directory FD or a stable consumer-visible canonical path.

Falsifiers include an accepted symlink/escape, `RESOLVE_NO_XDEV` allowing the existing distinct mount, original bytes changing under the pinned vault FD, link-count divergence, skipped rather than executed tests, or any official red job.

This does **not** establish an atomic root-rename concurrency guarantee, a power-loss guarantee, mount move/bind-mount adversarial coverage, a stable trust-root lifecycle, safe native integration, secure temp-file recovery, independent witness authenticity, correction completeness, trusted clock/revocation or an approved prospective evaluation protocol. `EAGAIN` under adversarial rename remains a distinct untested behavior; never turn it into unbounded retries. The test does not hook a live SDK call, modify the existing SDK, create a native binding or authorize merge.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, dormant/protected N2 activation, private raw T-5 values, secrets or private paths were used or changed.

Next safe step: investigate bounded `openat2` `EAGAIN` fail-closed behavior and independently specified common reader/writer namespace identity under deterministic interleavings, without adding production/native bridges or automatic cleanup.
