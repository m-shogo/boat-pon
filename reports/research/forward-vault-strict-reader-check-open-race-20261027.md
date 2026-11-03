# Forward Vault: strict pathname reader ancestor-check to open race

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
Date: 2026-10-27 JST
Scope: disposable, synthetic Linux research fixture; no SDK changes, recovery, production or private data
Evidence stage at report creation: regression committed, official GitHub Actions verification in progress; **no PASS claimed here**

## Authority, lineage and learning gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; one open PR #2286, preceding head `82615bc2cbc18d3da6f0d10dca46edc9bfd5e858`; previous CI #40486786749 SUCCESS. Main research-learning-loop and knowledge-retention contracts were read, together with relevant LEARN records, main EXP-dataset-expand-701398c2 and DISC-dataset-coverage-701398c2 (unrelated dataset lineage), empty Rejection registry, and merged PR #2285. The Boat Pon research automation remains enabled; Owner Dashboard work is separate.

Reused guardrails:
- `LEARN-forward-vault-dirfd-reachability-preflight-toctou-20261027` — a writer-side identity preflight is not atomic.
- `LEARN-forward-vault-real-ancestor-replacement-strict-readback-20261027` — an already-replaced real ancestor can pass strict pathname admission.
- `LEARN-forward-vault-strict-readback-ancestor-test-assumption-20261027` — never confuse raw pathname reads with strict SDK ancestor-symlink rejection.
- `LEARN-forward-vault-rename-race-stdout-framing-20261027` — synchronize on complete child output lines, not partial chunks.

Normalized candidate:
- fingerprintKey: `research-k3.forward-vault.strict-reader-ancestor-check-to-open-real-directory-race`
- attemptSignature: `pr2286-v385-two-process-reader-check-open-barrier-real-dir-rename`
- environmentKey: `github-actions-linux-node24-python3`
- materialStateKey: `executor-sdk-v3/pr2286-v384-existing-strict-ancestor-check-and-open-sequence`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. This tests a reader-side check-to-open interleaving, not a retry of the earlier writer-side preflight or a static pre-replaced-path test.

## Frozen protocol and intended assertions

Test: `src/research/governance/forwardEvaluationVault.strictReaderCheckOpenRaceLinux.test.ts`
Implementation: `7f0fe108c4a924246a4e9ab5bda2787dfb4d4e93`

1. Stage two complete synthetic, single-link JSON files under separate **real** directories. Their `writer` fields differ but both declare the same untrusted `outputDigest` string. Neither value is an authenticated full-payload hash.
2. A separate Python reader pins the original directory object by root/anchor/vault FDs opened component-by-component with `O_DIRECTORY | O_NOFOLLOW`. It mirrors the existing SDK's real-ancestor `lstat` checks and emits a **complete** `ANCESTORS_CHECKED\n` line before blocking for the parent process.
3. Control: release the reader without a swap; its final-component `O_NOFOLLOW | O_NONBLOCK` pathname open and pinned-FD open must both return original bytes.
4. Negative interleaving: only **after** the full checked line, the Node parent renames the original `anchor` to `moved`, then renames a distinct real `decoy` directory to `anchor`. It releases the Python reader with `OPEN\n`. The pathname open is expected to read decoy bytes, while the pinned-FD open is expected to read original bytes. Both must remain single-link regular files.
5. Separately call the unchanged SDK `verifyJsonReadback` **after** the swap on each pathname to demonstrate its normal acceptance of individually valid JSON. The SDK itself is **not instrumented or paused between its own checks and open**; the check-to-open boundary is mirrored in Python. No native renameat2, power-loss, mount-swap, or SDK exploit is asserted.
6. Cleanup is restricted to the unique disposable test root. No stale-name deletion, automatic recovery, production writer or protected N2 is invoked.

## Falsifiers and safety boundary

Falsifiers include the reader proceeding before the complete checked line, the replacement being a symlink rather than a real directory, an overwrite of the original pinned bytes, a different link count, a mismatch in the control case, or the Python reader failing to distinguish the two objects. Official CI must execute both tests before classifying the result; any red workflow requires five-layer job-log triage (payload, process exit, workflow, post-job, runner).

A positive result would **reject** the assumption that sequential ancestor `lstat` checks plus final-component `O_NOFOLLOW` atomically bind the pathname reader to the checked directory objects. It would **not** establish a production incident, prove a live SDK call was paused at the boundary, authenticate `outputDigest`, or authorize a new SDK, native bridge, deletion/recovery, merge, scoring or production path.

Unresolved: trusted reader/writer namespace and trust-root lifecycle, concurrent mount and rename behavior, durability under actual power loss, safe temp-file policy, independent source/witness, correction completeness, clock/revocation, frozen prospective cohort and approved evaluation protocol.

No Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, protected N2 activation, private raw T-5 values, secrets or private paths.
