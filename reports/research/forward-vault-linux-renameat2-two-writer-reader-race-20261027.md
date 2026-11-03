# Forward Vault: Linux renameat2 two-writer / strict-reader race

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: isolated synthetic process/filesystem regression; official GitHub CI separately required  
Scope: research-only; no SDK writer replacement, cleanup implementation, scoring, production or Owner Dashboard change

## Question, prior learning and lineage

Does the Linux-only native `renameat2(..., RENAME_NOREPLACE)` candidate preserve a single complete append-only destination under **two independently released processes**, and can the real SDK strict reader accept it **while the winning publisher is still alive**? Does a losing publisher retain its own staged bytes rather than silently deleting a potentially ambiguous path?

Canonical main at selection: `2342494f6581c167a5648681ca7374b26d6659d4`. Open research PR #2286. Read the latest-main research learning loop and knowledge retention contract. Reused `LEARN-forward-vault-linux-renameat2-single-link-20261027` (verified guardrail) and `LEARN-forward-vault-interrupted-hardlink-readback-20261027` (negative hardlink interruption). Prior v375 concurrent hardlink test is a **different primitive**. Prior Experiment/Discovery/Rejection lineage is not filesystem publication authorization; dataset inventory EXP/DISC records do not confer writer or scoring authority.

## Frozen disposable protocol

Regression: `src/research/governance/forwardEvaluationVault.renameNoReplaceRaceLinux.test.ts`; implementation commit `253206c697f3744689a092104d30b586907a559c`.

1. In a fresh disposable directory, create two distinct complete synthetic JSON records with the same record ID but different writer identifiers. Stage both via exclusive creation and file `fsync`.
2. Spawn two independent Python3/glibc child processes. Each signals READY and blocks on stdin. Confirm the destination is absent; release both with GO. Each attempts native Linux `renameat2` with `RENAME_NOREPLACE=1` and `AT_FDCWD`.
3. Require exactly one WON and one EEXIST/LOST; the winner waits on DONE **after** publication. While it is paused, verify exact winning JSON bytes, `nlink=1`, and `verifyJsonReadback(destination).ok=true` through the existing SDK reader.
4. Verify the winner's staged name is absent and the loser's staged name and exact bytes remain intact. No automatic cleanup or overwrite is attempted.
5. Release the winner, require normal exit, recheck strict readback, then terminate any unfinished children and remove only the disposable test directory.
6. Unsupported Linux/glibc/filesystem combinations are explicitly skipped; they are not counted as positive evidence.

The isolated local Linux/Node22/Python3 run passed the race fixture. That local run used a minimal readback stub to smoke-test orchestration; only official CI against the repository's real SDK `verifyJsonReadback` can validate the complete assertion. This report intentionally does not claim an official CI result before it completes.

## Falsification and limits

Two winners, no winner, unexpected syscall errors, incomplete or overwritten bytes, a two-link published file, strict-reader rejection during the winner's post-publication pause, or loss of the losing staged record falsify the bounded hypothesis. No assumption is made about which writer wins.

This does **not** prove power-cut durability, adversarial parent-directory replacement resistance, cross-filesystem behavior, NFS semantics, arbitrary concurrent cleanup safety, or a reviewed native Node binding. A successful syscall is not a universal persistence guarantee. In particular, a failed writer's staged name must not be removed solely on the basis of a previously checked pathname/inode: the earlier TOCTOU negative fixture still applies. The existing SDK remains on its current hardlink publication method and its fail-closed strict reader remains unchanged.

## Learning gate and decision

- `fingerprintKey`: `research-k3.forward-vault.linux-renameat2-two-writer-reader-race`
- `attemptSignature`: `pr2286-v378-two-python-process-barrier-native-no-replace-rename-reader`
- `environmentKey`: `local-linux-node22-python3-glibc+github-actions-linux-node24-pending`
- `materialStateKey`: `executor-sdk-v3/pr2286-v377-native-no-replace-probe-v378-independent-concurrent-reader-fixture`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse the verified Linux-only single-link candidate and the interrupted-hardlink failure guardrail. Do not retry ordinary `renameSync`, unsafe `openSync("wx")` publication or filename-only orphan cleanup.
- Expected classification if official CI passes: **REUSED_LEARNING**. The race confirmation is an extension of the already retained success, not a distinct new root cause or automatically a new LEARN. If official CI exposes a meaningful new failure, investigate full logs and persist a distinct LEARN before claiming it.

**Decision:** research candidate only. Still require reviewed native integration, dirfd-anchored namespace identity, filesystem capability matrix, cross-mount and crash/power-loss fault injection, safe failed-stage lifecycle, directory `fsync` semantics, and independent witness/finality/clock/revocation/evaluation-protocol authority. No merge or scoring permission.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 activation, private raw T-5 values, or private paths were accessed or modified.
