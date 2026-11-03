# Forward Vault interrupted no-replace publication: readback gate

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: synthetic research-only filesystem boundary; no real archive or production path used  
Evidence stage: engineering negative fixture, **not** a real process crash or real data-loss incident

## Question and mechanism

Does the current no-replace JSON writer preserve both its append-only destination and its readback contract if execution stops after publishing the hard link but before unlinking the temporary name?

The research SDK `src/research/governance/executorSdk.ts` writes a complete temporary file, `fsyncSync(fd)`, then uses `linkSync(temp, path)` to publish without replacing an existing destination. Its `finally` block unlinks `temp`. In the interval between those two operations the two names point to the same inode and the destination has `nlink=2`. `verifyJsonReadback` explicitly requires a regular file with `nlink===1`.

## Bounded synthetic reproduction

`src/research/governance/forwardEvaluationVault.persistence.test.ts` now models precisely the on-disk state between `linkSync` and `unlinkSync` with an ordinary synthetic Enrollment Protocol in a fresh temporary directory:

1. Write a complete synthetic JSON temporary file and hard-link it to the previously absent destination.
2. Assert that the destination contains the original JSON bytes and `nlink===2`.
3. Assert that `verifyJsonReadback` **fails closed** with the single-link regular-file error.
4. Assert that a repeated `atomicWriteJson` cannot replace the destination, while `classifyForwardVaultAppend` still classifies the original record as `IDEMPOTENT_NOOP`.
5. Remove only the known synthetic temporary hard link, then assert that `nlink===1`, readback succeeds and the original record digest is unchanged.

Local independent Node 22.16.0 filesystem check reproduced the `nlink=2` to `nlink=1` transition. The repository regression is subject to official PR CI; the fixture simulates an interruption state and does **not** terminate a real writer mid-syscall.

## Observed implication and limits

**Confirmed contract gap:** a process termination in this narrow window can leave a fully published destination with a second hard link, so strict readback refuses to accept it. This is an availability/recovery problem, **not** evidence that an existing record was overwritten, truncated, or that the digest collided. The fail-closed readback and no-replace write protections must remain intact.

The writer also does not currently `fsync` the containing directory after publication. Consequently the code alone does not establish a power-loss durability guarantee for the directory entry; the synthetic test does not measure power loss or filesystem-specific persistence. No frequency, crash probability, data-loss count, or readiness claim is inferred.

## Safe follow-up / falsification

A future bounded design should compare (a) a no-replace publication primitive with verified crash durability and (b) a strictly scoped same-inode orphan-temporary recovery protocol, including symlink, inode substitution, concurrency, cross-filesystem and directory-`fsync` tests. Never loosen `nlink===1` acceptance globally, delete an unverified temporary name, replace an existing destination, or auto-recover outside a dedicated research-only directory. Re-run full official CI before claiming a verified repair.

This finding is independent of real source authenticity, terminal settlement correction completeness, trusted clock/revocation, frozen prospective cohorts and approved evaluation protocol. **No scoring, promotion or production authority** follows. No Current BUY, LINE, public publishing, automated betting, Owner Dashboard, protected N2 or private raw T-5 evidence was touched.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.atomic-hardlink-interruption-readback-unavailable`
- `attemptSignature`: `pr2286-v370-synthetic-hardlink-postpublish-precleanup-recovery-fixture`
- `environmentKey`: `node22.16.0-local-synthetic+github-actions-node24-typescript6.0.3`
- `materialStateKey`: `executor-sdk-v3/pr2286-v369-linkSync-unlinkSync-no-replace-and-single-link-readback`
- Decision: `PROCEED_DISTINCT` (no matching LEARN for this interruption window); reuse append-only/no-replace and single-link readback guardrails. Record as `NEW_FAILURE` rather than treating green CI as recovery approval.
- Relevant lineage: existing `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` concern dataset coverage, not filesystem interruption. No matching Rejection registry record exists on canonical main.

