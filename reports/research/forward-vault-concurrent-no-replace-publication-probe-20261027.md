# Forward Vault: concurrent no-replace hard-link publication probe

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: disposable, synthetic, two-process research-only filesystem fixture; no SDK writer/recovery implementation change  
Evidence stage: bounded concurrent-publication regression; official GitHub CI is the verification authority

## Research question and authority

When two independent processes try to publish distinct, fully staged JSON files at the same append-only destination using the Executor SDK v3's `linkSync(temp, destination)` primitive, can both succeed or can either overwrite the winner? Does normal cleanup leave a single-link regular file eligible for strict readback?

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Open research PR: #2286. Contracts: `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`. Existing authority: `LEARN-forward-vault-interrupted-hardlink-readback-20261027`, the v370-v374 interrupted-hardlink, inode-substitution, directory-sync, alternative-publication and SIGKILL fixtures. `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` are dataset-inventory lineage, **not** filesystem publication evidence. No directly matching filesystem Rejection record was established.

## Frozen synthetic protocol

New test: `src/research/governance/forwardEvaluationVault.concurrentPublication.test.ts`, code commit `2bc8a26c349575c57c1b006df75f1feb4067867e`.

1. Create a fresh disposable OS temporary directory, one absent destination, and two distinct synthetic JSON records with the same record ID and different `writer` values. Stage each record at a separate exclusive temporary name, fsync its file descriptor, and close it.
2. Spawn two independent Node processes. Each emits `READY` and waits for an explicit parent `GO` message; the parent verifies the destination is absent until both children reach the barrier.
3. Release both contenders without selecting a winner. Each child attempts `linkSync(temp, destination)`; only `EEXIST` is an expected loser outcome. Each then unlinks **only its own** temporary name.
4. Require exactly one `WON` and one `LOST`, zero child errors, an exact byte-for-byte match to the winning staged record, `nlink=1`, successful strict `verifyJsonReadback`, and no remaining staged names.
5. Kill unfinished test children and delete only the disposable fixture directory during teardown. Skip Windows because this fixture's Unix-style hard-link/process assumptions are not asserted there.

The child code deliberately mirrors only the SDK's no-replace `linkSync` publication boundary. It does **not** invoke the complete SDK writer, test the entire application lifecycle, use private data, activate N2, or implement a new recovery primitive. This is a real two-process concurrency probe, but it is **not** a crash/power-loss test or a demonstration of arbitrary namespace adversaries.

## Decision, limitations, and falsification

A passing official CI test supports a bounded claim: on the tested runner filesystem, two concurrently released link publishers cannot both claim the same destination, and successful normal-path temporary-name cleanup permits single-link readback. This does **not** solve the already demonstrated post-link/pre-unlink SIGKILL orphan, guarantee parent-directory durability, prove protection against ancestor substitution, or establish a portable `renameat2(RENAME_NOREPLACE)` binding. The SDK itself remains unchanged.

The test is falsified by two winners, no winner, non-`EEXIST` contender error, overwritten/mixed JSON, lingering temporary names, or rejected normal-path readback. A future safe alternative still requires a documented filesystem capability matrix, adversarial namespace tests, crash boundary analysis, and an independently reviewed durability protocol. No automatic orphan cleanup or readback relaxation is authorized.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.concurrent-hardlink-no-replace-publication`
- `attemptSignature`: `pr2286-v375-two-node-process-barrier-synthetic-linkSync-contenders`
- `environmentKey`: `local-linux-node22.16.0-prototype+github-actions-linux-node24-pending`
- `materialStateKey`: `executor-sdk-v3/pr2286-v374-linkSync-unlinkSync-no-replace-single-link-readback`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse the orphan-hardlink Learning's strict readback/no-replace guardrail; do not retry unsafe filename-only cleanup or plain rename. This tests a distinct concurrent-writer boundary, not the already-reproduced interruption.
- Expected classification after official CI: **REUSED_LEARNING**; a routine confirmation of the existing no-replace guardrail does not justify a duplicate LEARN. Reclassify and durably record a new Learning before claiming a distinct meaningful failure or non-obvious reusable success.

## Remaining governance blockers

Independent evidence witness, settlement correction/finality completeness, trusted clock and revocation, prospective cohort freeze, approved v0.2 evaluation protocol, and safe crash recovery remain unavailable. **No merge, scoring, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 activation, or private raw T-5 evidence is authorized or changed.**
