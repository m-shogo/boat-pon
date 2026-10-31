# Forward Vault: dirfd canonical-path preflight TOCTOU counterexample

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: deterministic disposable Linux/glibc synthetic namespace fixture; official GitHub CI verification required  
Scope: research-only; no SDK writer, native integration, recovery, production, Owner Dashboard or protected N2 changes

## Question and authority

Does comparing the pre-opened directory FD's (st_dev, st_ino) with a no-follow stat of its expected canonical pathname **before** renameat2(RENAME_NOREPLACE) guarantee that the published record remains reachable to a consumer using that pathname?

Authority gate: canonical main 2342494f6581c167a5648681ca7374b26d6659d4, existing open PR #2286, latest-main research-learning-loop and research-knowledge-retention-contract, and preceding Linux namespace probes. Reused LEARN-forward-vault-linux-dirfd-parent-swap-20261027 and LEARN-forward-vault-linux-renameat2-single-link-20261027 as guardrails; the interrupted-hardlink readback learning remains relevant to avoiding filename-only cleanup. No matching unchanged failure was retried. Existing Experiment/Discovery/Rejection lineage does not establish a filesystem publication or production authority.

## Frozen synthetic protocol

Test: src/research/governance/forwardEvaluationVault.renameDirfdReachabilityLinux.test.ts  
Implementation commit: 326ff9d312e4ce96e8f8571c2ff88cbc7d212d43

Both scenarios create only fresh temporary synthetic JSON under anchor/ and a separate decoy under outside/. A child Python3/glibc process opens anchor with O_DIRECTORY | O_NOFOLLOW, pins the directory FD and waits for explicit synchronization commands. The parent uses the exact same rename-and-symlink substitution in both scenarios:

- **Swap before CHECK:** parent moves anchor to moved/ and replaces anchor with a symlink to outside/; the child compares fstat(dirfd) with no-follow stat(anchor) and must reject without publishing. The original staged file and decoy remain intact.
- **Swap after CHECKED but before GO:** child first verifies the original directory identity and reports CHECKED; parent then performs the same swap; child performs native dirfd-relative renameat2(..., RENAME_NOREPLACE). On a supported filesystem, publication succeeds into moved/ with one link and strict SDK readback there, but anchor/published.json is absent because anchor now resolves to outside/.

Explicit synchronization makes the order deterministic, rather than relying on timing or sleeps. File data are fsynced before the attempt, and directories are fsynced after assertions; neither is a power-loss durability proof. The entire test root is disposable and removed only by the test harness. Native unsupported platforms/filesystems skip rather than count as success.

## Expected interpretation and falsification

The first case establishes a useful **bounded rejection** for a substitution already visible at preflight. The second is a **counterexample** to treating that preflight as a sufficient consumer-reachability guarantee: the namespace can change after the check but before the atomic rename. An FD pins the directory object, not its original canonical pathname. A post-rename pathname check may detect the loss of reachability, but it cannot retroactively make publication atomic with the canonical-path assertion or safely authorize deletion.

The claim is falsified if a swapped preflight publishes despite the mismatch, if the decoy changes, if the post-check rename publishes into outside/, if published JSON is incomplete, or if strict readback of the moved single-link file fails on a supported runner. The probe does not establish exploitability in a real deployment, hostile mount behavior, general concurrent-writer correctness, crash/power-loss durability, safe failed-stage lifecycle, or a complete native API design.

## Learning gate

- fingerprintKey: research-k3.forward-vault.dirfd-canonical-reachability-preflight-toctou
- attemptSignature: pr2286-v380-dirfd-preflight-check-then-parent-swap-before-rename
- environmentKey: github-actions-linux-node24-python3-glibc
- materialStateKey: executor-sdk-v3/pr2286-v379-dirfd-parent-swap-fixture-v380-preflight-window
- Gate: REUSE_GUARDRAIL / PROCEED_DISTINCT
- Classification if officially verified: NEW_FAILURE (preflight-only canonical reachability assertion is insufficient). Record a digest-protected LEARN only after verification.

## Blockers and safe next step

A correct research-only design needs an explicitly defined canonical namespace/consumer contract and an authority mechanism that cannot be invalidated between verification and publication, or must fail closed without claiming canonical-path reachability. A one-time preflight is not that mechanism. Native integration, path/ancestor/mount threat modeling, independent evidence, settlement/correction authenticity, clock/revocation semantics and approved frozen evaluation protocol remain blocked. No production or BUY connection is permitted.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2, private raw T-5 odds/values, secrets or private paths were accessed or modified.
