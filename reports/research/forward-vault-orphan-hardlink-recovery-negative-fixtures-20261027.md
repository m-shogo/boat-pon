# Forward Vault orphan hardlink: recovery negative-fixture design

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: research-only synthetic filesystem test; **no automatic recovery implementation**  
Evidence stage: engineering safety-contract regression, not a real crash or durability guarantee

## Question and prior authority

After a process interruption between `linkSync(temp, destination)` and `unlinkSync(temp)`, is it safe to delete an apparent orphan temporary filename, or to trust a symlink at the destination? Prior reproduction: `reports/research/forward-vault-interrupted-hardlink-publication-readback-gate-20261027.md`, `LEARN-forward-vault-interrupted-hardlink-readback-20261027`.

The SDK publishes a complete, fsynced temporary file with no-replace `linkSync`; its strict readback requires a regular, single-link destination and rejects symlinks. Publication and temporary-name removal are separate operations. A filename alone is **not** a persistent inode identity, and readback rejection is not recovery authorization.

## Distinct synthetic fixtures added

`src/research/governance/forwardEvaluationVault.persistence.test.ts`:

1. Create a temporary JSON file and hard-link it to the destination, reproducing `nlink=2` and a fail-closed readback. Remove that temporary name, then create a **different inode at the same name**. Verify the published JSON/digest remain unchanged, readback returns to success when the original inode has one link, and the unrelated replacement is **left untouched**. This demonstrates why path-only orphan cleanup would be unsafe.
2. Create a symlink at the destination to a separate synthetic JSON file. Verify readback refuses the symlink and a no-replace append refuses to overwrite it. Verify both the symlink and the unrelated target bytes are preserved.

These are bounded sequential simulations. They do **not** prove a real concurrent-race outcome, actual power-loss durability, safe recovery, or absence of all time-of-check/time-of-use vulnerabilities. CI verification is required before the fixtures are called passing.

## Decision and non-authority

**No automatic orphan cleanup, relaxed single-link readback, or changed SDK writer is justified.** An eventual recovery design would need a scope-limited research directory, inode/device checks on already-open descriptors, symlink-safe directory handling, a strategy that prevents substitution between verification and unlink, concurrent-writer proof, and directory-entry durability evidence (including parent directory fsync where supported). Ordinary `stat` followed by `unlink` is not an atomic inode-conditional deletion and must not be presented as race-safe.

Existing immutable append/no-replace behavior and strict readback remain unchanged. No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2, or private raw T-5 evidence was accessed or modified.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.orphan-hardlink-recovery-negative-fixtures`
- `attemptSignature`: `pr2286-v371-synthetic-temp-inode-reuse-and-destination-symlink-negative-fixtures`
- `environmentKey`: `github-actions-node24-typescript6.0.3+node22.16.0-synthetic`
- `materialStateKey`: `executor-sdk-v3/pr2286-v370-no-replace-hardlink-single-link-readback`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse `LEARN-forward-vault-interrupted-hardlink-readback-20261027`; this is a distinct negative-fixture method, not a retry of the interrupted-readback test. No new Learning unless CI or investigation establishes a distinct meaningful failure/non-obvious reusable result.
- Related existing lineage: `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` concern dataset coverage, not filesystem recovery. No matching Rejection authority established.

Independent witness, terminal correction completeness, trusted clock/revocation and approved forward evaluation protocol remain unavailable. **No merge/promotion authority.**
