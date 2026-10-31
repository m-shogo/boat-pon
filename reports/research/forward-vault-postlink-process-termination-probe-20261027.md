# Forward Vault: post-link process termination boundary

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: disposable, synthetic research-only process-termination fixture; no writer/recovery implementation change  
Evidence stage: deterministic process-termination regression, subject to official CI verification

## Question and hypothesis

Does a real terminated writer, held after the current no-replace hard-link publication but before temporary-name cleanup, reproduce the known readback-availability gap without altering published bytes or weakening append-only identity?

The existing LEARN-forward-vault-interrupted-hardlink-readback-20261027 established the gap with a synthetic on-disk state. The v371/v372 negative fixtures ruled out filename-only cleanup and showed directory fsync does not remove orphan links. The v373 counterexamples ruled out plain exclusive-create and rename as safe drop-in alternatives. This experiment strengthens the interruption evidence **without repeating the failed cleanup methods**.

## Protocol and boundaries

New regression: src/research/governance/forwardEvaluationVault.processTermination.test.ts.

1. In a newly created OS temporary directory, a child Node process writes only synthetic JSON to an exclusive temporary name, calls file fsync, closes it, then calls linkSync(temp, destination).
2. The child emits LINKED only after successful publication and blocks indefinitely at a fixed checkpoint. The parent waits for that explicit handshake; no sleep-based race decides the kill point.
3. The parent checks the two pathnames refer to the same inode with two links, sends SIGKILL to the child, and waits for termination.
4. The parent checks destination bytes remain unchanged, strict verifyJsonReadback denies nlink=2, and atomicWriteJson refuses replacement. It performs **no orphan cleanup or readback relaxation**.
5. Test teardown deletes only its own disposable fixture directory. The test is skipped on Windows; CI runs on Linux.

The child implements the same relevant sequence of filesystem operations as executorSdk.atomicWriteUtf8, but is an isolated test harness, **not** a call to the full SDK writer. The harness deliberately stops before the SDK's finally cleanup. A test assertion does not imply any real production writer was terminated.

## Interpretation and limitations

A successful regression would demonstrate that the previously synthetic post-link/pre-unlink state is reachable after a controlled real **process termination** on the test filesystem. It does not demonstrate data loss, real-world incidents, safe automatic recovery, cross-process namespace security, SIGKILL semantics on other platforms, or power-loss durability. Neither file fsync nor parent-directory fsync alone establishes full crash consistency.

A future alternative must preserve all-or-nothing visibility **and** no-replace identity while handling the orphan state, same-inode name substitution, concurrent writers, symlink/ancestor substitution, filesystem capabilities, and directory durability ordering. Linux renameat2(RENAME_NOREPLACE) is a possible platform-specific research candidate, **not** a Node fs.renameSync guarantee or an approved replacement. Any native binding/sidecar would require explicit cross-platform review and adversarial tests. No such implementation is added here.

## Authority and learning gate

- Canonical main: 2342494f6581c167a5648681ca7374b26d6659d4; existing research PR: #2286.
- Authoritative contracts: docs/architecture/research-learning-loop.md, docs/architecture/research-knowledge-retention-contract.md.
- Related K2 records: LEARN-forward-vault-interrupted-hardlink-readback-20261027; prior v371-v373 reports and fixtures. Existing dataset-inventory Experiment/Discovery records are unrelated to filesystem publication; no directly matching Rejection was identified.
- fingerprintKey: research-k3.forward-vault.postlink-process-termination-readback
- attemptSignature: pr2286-v374-sigkill-child-after-hardlink-handshake-before-temp-cleanup
- environmentKey: github-actions-linux-node24-typescript6.0.3
- materialStateKey: executor-sdk-v3/pr2286-v373-hardlink-no-replace-single-link-readback
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse the existing orphan-hardlink Learning and reject unsafe filename-only cleanup; this is a materially different interruption probe, not a retry of recovery.
- Expected classification if CI confirms: **REUSED_LEARNING**. The root-cause class is already durably recorded; no duplicate LEARN is justified merely by stronger evidence.

## Falsification and next action

The test would fail if a controlled terminated child did not leave the expected published bytes/two-link state, if strict readback accepted the orphan, or if append replaced the destination. A passing test would **not** prove a safe recovery design.

Next: separately evaluate a platform-specific no-replace publication capability and concurrent namespace/reader behavior with synthetic fixtures before considering any SDK implementation. Do not add automatic deletion or broaden production authority.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2, or private raw T-5 data is read, activated or modified.
