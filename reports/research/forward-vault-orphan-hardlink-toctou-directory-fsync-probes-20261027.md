# Forward Vault orphan-hardlink TOCTOU and directory-sync probes

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: synthetic, research-only filesystem tests; no automatic recovery, SDK writer change, or production connection  
Evidence stage: engineering negative fixtures / syscall capability observation; **not** a real crash, concurrent execution trace, or power-loss durability proof

## Question and authority

Can an inode equality check taken *before* a cleanup unlink safely authorize deleting a temporary filename? Does syncing the parent directory resolve a post-publication orphan hard link or prove crash durability?

Prior authority: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `LEARN-forward-vault-interrupted-hardlink-readback-20261027`, `reports/research/forward-vault-interrupted-hardlink-publication-readback-gate-20261027.md`, and `reports/research/forward-vault-orphan-hardlink-recovery-negative-fixtures-20261027.md`. The earlier v371 fixture modeled a name already replaced *before* inode inspection; this fixture moves the substitution **after** a matching preflight observation.

The shared research Executor SDK v3 writes and fsyncs a temporary file, publishes it through no-replace `linkSync(temp, destination)`, and unlinks the temporary name in `finally`. Strict `verifyJsonReadback` refuses a non-regular or multiply linked destination. It currently does not fsync the parent directory as part of publication.

## Distinct bounded checks

`src/research/governance/forwardEvaluationVault.persistence.test.ts`:

1. Create two hard links to the same synthetic record and observe matching `dev` and `ino` for the temporary name and published destination. **After** that observation, rename the original temporary link and replace its former pathname with unrelated synthetic content. Assert that the replacement has a different inode, the published JSON and held link remain intact, strict readback still refuses `nlink=2`, and a second append cannot replace the destination. The test intentionally performs **no cleanup unlink** of the substituted path. A preflight `stat` + later pathname `unlink` cannot enforce an inode-conditional deletion.
2. On Linux, fsync the synthetic temporary file, publish the no-replace hard link, open the parent directory with `O_DIRECTORY` and fsync its descriptor. Assert the orphan remains `nlink=2` and readback still fails closed. Remove **only the known fixture temporary link**, fsync the directory again, then assert `nlink=1`, successful readback and identical Forward Vault digest. This is a bounded filesystem syscall check, **not** a test of actual power loss, filesystem durability guarantees, or a proposal to clean arbitrary names.

Both tests use fresh OS temporary directories and synthetic enrollment metadata. The Linux directory probe is skipped on other platforms; official GitHub CI is required to establish repository regression status. No private data, odds, real archive or live research input is used.

## Decision and falsification

**No automatic orphan recovery, generic path-based cleanup, relaxed readback, production change or SDK-wide directory-fsync behavior is authorized.** A future safe design needs a scope-limited research namespace, stable directory handles and adversarial cross-writer tests, including inode substitution between inspection and unlink. File identity alone does not make a later pathname unlink atomic. Parent-directory fsync should be evaluated for the chosen filesystem and ordering, but successful fsync syscalls alone do not prove power-loss durability or solve `nlink=2`.

Falsification would require a concrete, reviewable primitive or protocol that prevents substitution through the destructive operation, plus adversarial concurrent-writer evidence and a documented durability model. Neither is supplied here. Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard and protected N2 remain untouched.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.orphan-hardlink-postcheck-substitution-directory-fsync`
- `attemptSignature`: `pr2286-v372-synthetic-postcheck-temp-replacement-and-parent-directory-fsync-probe`
- `environmentKey`: `github-connector/github-actions-node24-typescript6.0.3+node22.16.0-synthetic-linux`
- `materialStateKey`: `executor-sdk-v3/pr2286-v371-linkSync-unlinkSync-no-replace-single-link-readback`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse `LEARN-forward-vault-interrupted-hardlink-readback-20261027` and the v371 negative-fixture design; do not retry or promote filename-only cleanup. This is a distinct *race window* fixture, not a new independent root cause or proof of a recovery method. No new LEARN unless subsequent evidence demonstrates a distinct meaningful outcome.
- Related Experiment/Discovery: `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` address dataset coverage, not filesystem recovery. No matching Rejection identified.

Independent evidence trust, settlement correction completeness, trusted clock/revocation, prospective cohort freeze and approved evaluation protocol remain unresolved. **No merge/promotion authority.**
