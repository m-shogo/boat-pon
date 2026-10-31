# Forward Vault: ancestor symlink bypasses final-component O_NOFOLLOW

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: disposable Linux/Python3 namespace fixture; GitHub Actions verification pending at report creation  
Scope: research-only negative fixture; no SDK writer, native integration, recovery, scoring, production, Owner Dashboard or protected N2 changes

## Question and authority

Does opening a nested vault directory with `O_DIRECTORY | O_NOFOLLOW` prevent an untrusted **ancestor** directory component from redirecting the directory FD to a decoy? Does walking components relative to a previously trusted root FD reject the same ancestor symlink while still admitting a normal directory hierarchy?

Authority gate: canonical main `2342494f6581c167a5648681ca7374b26d6659d4`, open research PR #2286, latest-main `research-learning-loop.md` and `research-knowledge-retention-contract.md`, recent research CI and merged PR history. Relevant durable learning: `LEARN-forward-vault-linux-dirfd-parent-swap-20261027` (directory-object anchoring) and `LEARN-forward-vault-dirfd-reachability-preflight-toctou-20261027` (preflight cannot guarantee consumer-visible reachability), plus the Linux single-link publication guardrail. No equivalent unchanged failure was retried. Existing Experiment/Discovery/Rejection lineage provides no filesystem or production authority.

## Frozen disposable protocol

Test: `src/research/governance/forwardEvaluationVault.dirfdAncestorSymlinkLinux.test.ts`  
Code commit: `3dc0ea7427076c9b6fe8587b4983af34cb8163d3`

1. Create a new temporary root with `decoy/vault` and `real/vault`, a synthetic staged JSON only in the decoy, and `alias` as a symlink to `decoy`.
2. In a Python3 child, open `root/alias/vault` using `O_RDONLY | O_DIRECTORY | O_NOFOLLOW`. Verify by `fstat` that this apparently no-follow open actually points at the decoy vault: `alias` is an intermediate component, while the final `vault` is a real directory.
3. Open the trusted root as a directory FD. Attempt `os.open("alias", flags, dir_fd=root_fd)`; require `ELOOP` or `ENOTDIR` and do not traverse the symlink. Walk the normal `real` then `vault` components with the same flags relative to their parent FDs; require their identity to match the real vault.
4. Require exact child result markers, successful exit, no stderr, preserved decoy JSON, and no publication into either directory. Remove only the disposable test root in a `finally` block. On non-Linux or without Python3, the test is explicitly skipped.

The Linux local smoke of the Python core emitted `UNSAFE_ANCESTOR_FOLLOWED`, `COMPONENT_SYMLINK_REJECTED`, and `REAL_COMPONENTS_ACCEPTED`. Official CI must establish the integrated Node regression and typecheck; this report does not predeclare CI success.

## Interpretation and falsification

`O_NOFOLLOW` constrains the **last component of the particular open call**, not every ancestor in a multi-component pathname. A nested path can therefore resolve through an intermediate symlink and yield an FD for an unintended directory. A component-wise, dirfd-relative walk with no-follow at each step rejects this exact symlink while admitting an ordinary directory hierarchy.

Falsifiers: nested no-follow open fails to reach the decoy in this fixture; component-wise open follows the symlink; ordinary real hierarchy is rejected; the decoy is mutated; unexpected child exit; or the integrated test fails on a supported runner.

This does **not** establish a production exploit, adversarial mount/rename resistance, atomic reachability of a mutable canonical pathname, safe native Node binding, complete `openat2` semantics, crash/power-loss durability, automatic cleanup, or an approved vault writer. A pinned FD protects an object, not the ability of path-based consumers to find it after namespace changes.

## Learning gate

- fingerprintKey: `research-k3.forward-vault.dirfd-ancestor-symlink-final-component-nofollow`
- attemptSignature: `pr2286-v381-nested-ancestor-symlink-unsafe-open-vs-component-dirfd-walk`
- environmentKey: `local-linux-python3+github-actions-linux-node24-python3`
- materialStateKey: `executor-sdk-v3/pr2286-v380-dirfd-reachability-fixture-v381-ancestor-component-admission`
- Gate: `REUSE_GUARDRAIL / PROCEED_DISTINCT`
- Classification upon official verification: `NEW_FAILURE` of the candidate assumption that final-component `O_NOFOLLOW` authenticates the full directory path. A digest-protected `LEARN-*` must be stored after official verification before claiming durable learning.

## Blockers and next safe step

Research an explicitly trusted root FD, per-component no-follow traversal (or independently reviewed `openat2` resolution constraints), then evaluate read/write namespace consistency and concurrent ancestor rename/mount threats with deterministic fixtures. This fixture deliberately performs **no publication**. Do not infer that component-wise admission alone closes the post-check canonical-reachability TOCTOU demonstrated by v380.

Independent evidence provenance, terminal settlement/correction completeness, clock/revocation, frozen cohort and approved evaluation protocol remain missing. No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2, private raw T-5 values, secrets or private paths were accessed or modified.
