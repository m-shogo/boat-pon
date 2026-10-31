# Forward Vault: Linux renameat2 dirfd identity under parent pathname substitution

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: isolated Linux/glibc synthetic namespace probe; official GitHub CI required  
Scope: research-only; no SDK writer, recovery, production, scoring or Owner Dashboard changes

## Question and authority

Can a Linux native renameat2(RENAME_NOREPLACE) publisher that uses a pre-opened directory file descriptor keep both staged and destination names bound to the originally opened directory after the *pathname* for that directory is moved and replaced by a symlink to another directory?

Canonical main at selection: 2342494f6581c167a5648681ca7374b26d6659d4. Open research PR #2286. Read latest-main research-learning-loop and research-knowledge-retention-contract. Reused LEARN-forward-vault-linux-renameat2-single-link-20261027 (Linux-only candidate and explicit dirfd guardrail) and LEARN-forward-vault-interrupted-hardlink-readback-20261027 (hardlink interruption failure). The v378 two-writer/reader test covers ordinary concurrency, not ancestor pathname substitution. Dataset EXP-dataset-expand-701398c2 and DISC-dataset-coverage-701398c2 are unrelated inventory lineage and provide no filesystem, scoring, or promotion authority; no rejection registry entry applies.

## Frozen disposable protocol

Test: src/research/governance/forwardEvaluationVault.renameDirfdLinux.test.ts  
Implementation commit: 765e127bb397a500156b47a8f450485b5e6ad8e3

1. Create a fresh temporary root containing anchor/ and outside/. Stage fsynced complete synthetic JSON in anchor/staged.json and a distinct decoy JSON in outside/staged.json. No private or real race/odds data are involved.
2. Spawn a separate Python3/glibc process. It opens anchor with O_DIRECTORY | O_NOFOLLOW and holds that directory FD, then sends READY. It does not resolve the source/destination names through the original absolute parent path during the rename.
3. After READY, the parent moves anchor to moved/ and replaces the original anchor pathname with a symlink to outside/. Assert the original path now resolves to outside/.
4. Release the child with GO. It calls native renameat2(dirfd, "staged.json", dirfd, "published.json", RENAME_NOREPLACE).
5. On a supported runner/filesystem, require success, the complete JSON in moved/published.json, nlink=1, strict SDK verifyJsonReadback success, no moved/staged.json, and the outside decoy unchanged with no outside/published.json. Fsync moved/ and the temporary root, without claiming power-loss durability.
6. If native support is absent or the filesystem rejects RENAME_NOREPLACE, skip explicitly rather than treating that environment as positive evidence. Kill an unfinished child and remove only the disposable test root.

A local Linux/Node22/Python3 smoke run passed using a minimal readback stub. This local smoke establishes the orchestration only; the official CI must exercise the repository's real SDK reader and typecheck. CI was pending when this report was written.

## Falsification and limitations

Publication into outside/, a changed decoy, a missing/partial moved destination, a two-link published inode, strict reader rejection, or unexpected child exit falsifies the bounded hypothesis.

The directory FD protects the opened directory object against this **specific deterministic parent pathname substitution**. It does **not** guarantee that the directory is still reachable at the intended canonical pathname after the swap. It does not prove safety against hostile mount manipulation, all concurrent namespace operations, all filesystems, cross-device renames, untrusted native bindings, power loss, or unsafe staged-file deletion. An end-to-end writer must define and revalidate the expected namespace identity and consumer reachability before it can claim safe publication.

The existing SDK still uses its existing hardlink publication path. No recovery, cleanup, native Node integration, or production writer is introduced.

## Learning gate

- fingerprintKey: research-k3.forward-vault.linux-renameat2-dirfd-parent-path-substitution
- attemptSignature: pr2286-v379-dirfd-open-before-rename-symlink-swap-native-noreplace
- environmentKey: local-linux-node22-python3-glibc+github-actions-linux-node24
- materialStateKey: executor-sdk-v3/pr2286-v378-native-no-replace-race-v379-dirfd-namespace-fixture
- Gate: REUSE_GUARDRAIL / PROCEED_DISTINCT. No unchanged failure attempt is repeated; do not use filename-only cleanup or weaken strict readback.
- Outcome classification is conditional on official CI. A new durable LEARN may be added only after official verification if the dirfd-specific cause/change/verification is reusable.

## Remaining engineering and research blockers

Reviewed native integration, filesystem/capability matrix, verified namespace identity and canonical reachability, crash/power-cut durability, safe failed-stage lifecycle, independent evidence witness, terminal settlement/correction completeness, clock/revocation semantics, and approved frozen evaluation protocol remain unavailable. CI success does not authorize merge, scoring, Current BUY, or production connection.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 activation, private raw T-5 values, or private paths were accessed or modified.
