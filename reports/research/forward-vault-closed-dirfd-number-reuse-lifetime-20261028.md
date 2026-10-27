# Forward Vault: closed directory FD number reuse can redirect a synthetic publisher

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: disposable Linux process-local FD lifetime and atomic no-replace synthetic probe. **No production, recovery, scoring or merge authority.**

## Authority and learning gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Only open research PR: [#2286](https://github.com/m-shogo/boat-pon/pull/2286). Read latest-main research learning-loop and knowledge-retention contracts, recent merged #2285 Forward Vault core, existing EXP/DISC dataset-coverage lineage and empty Rejection registry, plus relevant directory provenance/reachability and `openat2` LEARN records. No protected N2 run.

- fingerprintKey: `research-k3.forward-vault.closed-dirfd-number-reuse-wrong-publisher`
- attemptSignature: `pr2286-v390-disposable-closed-fd-integer-reuse-vs-live-dup-no-replace`
- environmentKey: `local-linux-node22-python3-glibc+github-actions-linux-node24-python3`
- materialStateKey: `executor-sdk-v3/pr2286-v389-pinned-final-fd-bootstrap-no-lifetime-check`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Existing Learning covers late bootstrap, path swaps and preflight TOCTOU; this test isolates the distinct **process-local descriptor lifetime** after a correct directory was already opened. Do not retry the old preflight-only remedy.

## Fixed question, protocol and controls

Can a publisher that initially opened the correct final-directory FD accidentally publish into an unrelated directory if it retains only the numeric descriptor, closes the FD, and that number is reused? Does a **live duplicated FD** preserve the original object in this bounded setup?

The new `src/research/governance/forwardEvaluationVault.dirfdLifetimeLinux.test.ts` creates two disposable synthetic directories, each with a distinct fsynced staged JSON. A bounded Python subprocess uses Linux `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC` and `renameat2(RENAME_NOREPLACE)` (when available). No mount, symlink, real source, network, SDK writer, automatic cleanup of published data, or production behavior is exercised.

1. **Stale-number negative control:** open the original directory, save its integer FD, close it, open the unrelated decoy directory and assert Linux reused the same integer. Calling `renameat2` with the stale number publishes the decoy's complete single-link JSON. The original staged file is unchanged.
2. **Live-dup control:** duplicate the original FD **before** closing it, then reopen the decoy under the original numeric FD. Publishing and reading through the still-live duplicate operates on the original directory; decoy staged bytes are unchanged. The duplicate is a process-local lifetime control, **not** independently authenticated directory provenance.

Both cases verify exact synthetic JSON bytes, no-replace publication, single hard link and preservation of the non-target staged file. Unsupported Linux native functionality is reported as SKIP, not a successful execution. This is a deliberately controlled FD-reuse fixture, not a stochastic race or a claim that all platforms reuse FD integers identically.

## Observation, falsifiers and limits

Local Linux Node 22/Python 3.13: **2 PASS / 0 FAIL / 0 SKIP** with `node --experimental-strip-types --test`. Test commit: `4d71777ca7e7a136b50e9fe36598535b00ce5be1`. **Official GitHub Actions verification is pending at initial report creation; check latest-HEAD CI and logs before claiming official success.**

Falsifiers include no FD-number reuse in this controlled fixture, wrong target in the live-dup control, partial or wrong JSON, extra hard links, staged-file mutation, or a failed official test. This does **not** demonstrate a current SDK defect, cross-process FD transfer, cryptographic provenance, canonical-path reachability, mount safety, power-loss durability or safe recovery.

**Design guardrail:** never cache a bare numeric FD after `close()` as a directory capability. Retain a live owned descriptor for the full operation and manage its lifecycle explicitly; independently authenticate the final directory before relying on it. `dup()` addresses this narrow lifetime failure only, not bootstrap trust, post-check path swaps or filesystem persistence.

Independent witness, complete settlement corrections, trusted time/revocation, frozen cohort and approved v0.2 evaluation protocol remain unavailable. No Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, protected N2, private raw odds/values/paths, or scoring authority changed.

**Next safe step:** assess cross-process FD transfer/lifetime and close-on-exec ownership in a separate disposable fixture, only if distinct from prior Learning; otherwise audit the existing research-only call graph and fail-closed policy. Never introduce native production bridging or automatic stale-path deletion.
