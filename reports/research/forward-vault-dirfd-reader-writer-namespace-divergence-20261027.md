# Forward Vault: same-dirfd reader/writer namespace versus canonical-path divergence

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: disposable Linux/Python3/glibc synthetic fixture; **official GitHub Actions verification pending at report creation**  
Scope: research-only negative/positive boundary probe; no SDK writer/readback API, production, Owner Dashboard, protected N2, recovery or automatic cleanup changes

## Question and authority gate

Can a reader and writer using the **same previously admitted directory FD** continue to address the same JSON record after the directory's ancestor is renamed and its former pathname is redirected to a decoy? Can an independently valid JSON at the old pathname make a path-only integrity check appear healthy while it reads a **different object**?

Before the attempt: canonical main `2342494f6581c167a5648681ca7374b26d6659d4`, open PR #2286 (single open PR), latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, previous CI #40479725583 SUCCESS, recent merged research PR #2285, and enabled Boat Pon hourly automation were inspected. Relevant existing Learning: `LEARN-forward-vault-dirfd-ancestor-symlink-20261027` (per-component no-follow admission), `LEARN-forward-vault-linux-dirfd-parent-swap-20261027` (object anchoring), `LEARN-forward-vault-dirfd-reachability-preflight-toctou-20261027` (canonical pathname can diverge), and `LEARN-forward-vault-rename-race-stdout-framing-20261027` (require complete child result frames). Existing Experiment/Discovery/Rejection lineage does not grant filesystem or production authority. This is a distinct namespace readback probe, not a retry of a failed preflight-only reachability guarantee.

## Frozen disposable protocol

Test: `src/research/governance/forwardEvaluationVault.dirfdReaderWriterNamespaceLinux.test.ts`  
Implementation commits: `6220d3ae0d743eeb078a59b0fe8511539e8ba47e` (initial fixture), `3d0b5684c30fb6b20226d041e83483f08d9fff78` (strict SDK readback expectation corrected after source audit)

1. In a fresh temporary root, stage a fully fsynced synthetic JSON under `anchor/vault/staged.json`. Independently stage a **different but valid** JSON under `decoy/vault/published.json`. These are disposable synthetic strings, not private race evidence.
2. A Python3 child opens a trusted root directory FD, then separately opens `anchor` and `vault` relative to their parent FDs with `O_DIRECTORY | O_NOFOLLOW`; no multi-component untrusted nested open is used.
3. The child renames `anchor` to `moved` and installs a relative `anchor -> decoy` symlink. It calls Linux/glibc `renameat2` with `RENAME_NOREPLACE` for `staged.json -> published.json` **relative to the already pinned vault FD**.
4. The child opens `published.json` relative to that **same vault FD** using `O_NOFOLLOW`; it requires exact anchored JSON bytes, a regular file and `nlink=1`. It then deliberately reads the original pathname `anchor/vault/published.json` and requires the **different decoy JSON**. The child emits two complete newline-terminated outcome frames and fsyncs the vault/root directories.
5. The Node test requires successful child exit and exact frames, confirms the original pathname is now a symlink, checks the moved anchored JSON and decoy bytes independently, and confirms the moved anchored path passes the **existing** `verifyJsonReadback` integrity check, while the original symlinked ancestor pathname is **rejected** by its `assertRealDirectoryAncestors` guard. A plain `readFileSync` at that old path nevertheless follows the symlink and reads the decoy. The test cleans up only its own disposable root. A missing native `renameat2` or unsupported filesystem returns a skip, never a synthetic success.

## Expected observation and limits

A successful supported run would demonstrate **bounded object-namespace consistency** when both read and write operations share the same pinned directory FD. It would simultaneously demonstrate that an ordinary pathname reader can follow a replaced ancestor to valid but unrelated JSON. The **existing strict SDK reader already rejects the symlinked ancestor** rather than accepting the decoy; this is an important pre-existing guardrail, not a newly discovered SDK acceptance failure. That rejection still does not restore the publisher's canonical-path reachability or implement an FD-relative SDK reader.

Falsifiers: FD-relative read returns decoy bytes, no-replace overwrites an existing destination, anchored file has multiple hardlinks, raw original pathname unexpectedly resolves to anchored content, strict SDK readback accepts the substituted ancestor symlink, decoy content changes, incomplete child output, unexpected exit, or official CI fails on a supported runner.

This fixture does **not** establish a safe integration path for the current path-only SDK reader, an externally authenticated directory identity, safe mount/rename concurrency beyond the deterministic swap, canonical-path reachability, crash/power-loss durability, native binding portability, safe orphan cleanup, approved v0.2 evaluation/scoring, or production readiness. The strict SDK's rejection of the substituted ancestor is **not** proof that the record is still reachable through the original pathname. A successful raw pathname read is not authenticated readback. No existing SDK API was changed.

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.dirfd-reader-writer-namespace-path-divergence`
- `attemptSignature`: `pr2286-v383-component-openat-same-dirfd-read-write-parent-rename-symlink-decoy`
- `environmentKey`: `github-actions-linux-node24-python3-glibc`
- `materialStateKey`: `executor-sdk-v3/pr2286-v382-ancestor-symlink-reachability-guardrails-v383-same-fd-reader-probe`
- Gate: `REUSE_GUARDRAIL / PROCEED_DISTINCT`
- Expected classification after verification: `REUSED_LEARNING`; the identity/reachability distinction and no-follow ancestry guardrails are already captured in existing digest-protected LEARN records. Do not create a duplicate LEARN for routine green CI.

## Blockers and next safe action

Define a reviewed reader/writer namespace authority and trust-root lifecycle; determine whether a future read-only FD-relative API can be isolated from the legacy pathname consumer, and test parent renames **between** reader admission and read, as well as adversarial mount changes, with deterministic barriers. Do not automatically delete files, bypass the existing strict SDK ancestor rejection, infer publisher identity from raw path-only JSON parsing, activate protected N2, or connect to Current BUY, LINE, public publishing, automated betting, production settings, or Owner Dashboard.

Independent evidence provenance, terminal correction completeness, trustworthy clock/revocation, prospective frozen cohort and approved evaluation protocol remain unavailable. No private raw T-5 odds/values, secrets or private paths are included.
