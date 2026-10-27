# Forward Vault: strict readback during normal hard-link publication

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: disposable synthetic research-only cross-process test; no SDK, production, recovery or Owner Dashboard change  
Evidence stage: deterministic negative fixture; official CI must be verified separately

## Question

Does the existing strict `verifyJsonReadback` single-link invariant temporarily deny an otherwise complete record during a **normal, live writer's** post-`linkSync(temp, destination)` / pre-`unlinkSync(temp)` interval, even without a crash?

Prior `LEARN-forward-vault-interrupted-hardlink-readback-20261027` and the v370/v374 fixtures established the orphan-link condition after a modeled interruption and controlled SIGKILL. The v375 contender test established one-winner no-replace behavior after cleanup. This probe isolates the **concurrent reader visibility boundary** in an otherwise normally completing writer; it does not retry an unsafe cleanup design.

## Fixture and falsifiable observations

`src/research/governance/forwardEvaluationVault.readbackPublicationWindow.test.ts`:

1. Stage and `fsync` complete synthetic JSON in a disposable directory.
2. A separate Node child calls `linkSync(temp, destination)`, emits a `LINKED` handshake and blocks until the parent explicitly releases it.
3. While the child is alive and paused, the parent checks that the two names identify the same inode, `nlink=2`, and destination bytes are complete; it calls the **real** `verifyJsonReadback` and expects fail-closed single-link denial.
4. The parent releases the child; it unlinks only its own staged name and exits normally. The parent checks `nlink=1`, unchanged destination bytes and successful strict readback.
5. Test teardown removes only the disposable fixture directory. Windows is skipped. No sleep-based race, existing artifact deletion, readback relaxation, native syscall binding, production path or real data is involved.

A passing test demonstrates a deterministic *possible* transient readback denial while a normal writer is between two separate filesystem operations. It does **not** measure how often an actual caller reads during this short interval, demonstrate a production incident, establish power-loss durability, or justify automatic retries/deletion. A failing test should be analyzed by layer (fixture/process/CI/post-job/runner), not attributed to platform failure without logs.

## Decision and limits

Keep append-only no-replace and strict readback unchanged. Treat a normal-path `nlink=2` readback rejection as a possible **availability** boundary, not proof of corruption or a license to accept multi-link files. A future design must independently review the reader/writer coordination and a vetted atomic no-replace publication primitive (including filesystem support, namespace substitution and directory durability) before any SDK change. No unsafe filename-only cleanup, blind retry or protected N2 diagnostic is authorized.

The independent witness, terminal correction completeness, trusted clock/revocation and approved v0.2 evaluation protocol remain unavailable. CI success is not a promotion/merge decision.

## Authority and learning gate

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; research PR #2286.
- Authoritative contracts: `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`.
- Relevant Learning: `LEARN-forward-vault-interrupted-hardlink-readback-20261027`; v371–v375 negative and process/concurrency reports. The main-branch dataset-inventory EXP/DISC records are unrelated to filesystem publication; no directly relevant Rejection record exists.
- `fingerprintKey=research-k3.forward-vault.normal-publication-single-link-readback-window`
- `attemptSignature=pr2286-v376-paused-live-writer-postlink-preunlink-cross-process-reader-negative-fixture`
- `environmentKey=github-actions-linux-node24-typescript6.0.3`
- `materialStateKey=executor-sdk-v3/pr2286-v375-linkSync-unlinkSync-no-replace-single-link-readback`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. This is a distinct concurrent-reader observation of the same already retained two-link root cause, not a third attempt at failed cleanup.
- Classification: **REUSED_LEARNING** if verified; no duplicate LEARN is warranted without a new independent reusable root cause.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 activation, or private raw T-5 evidence is accessed or changed.
