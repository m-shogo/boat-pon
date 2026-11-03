# Forward Vault: real-directory ancestor replacement redirects strict pathname readback

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Scope: isolated research-only Linux negative fixture; no SDK, production, recovery or cleanup changes  
Evidence stage: local Linux Python3/glibc probe PASS; official GitHub Actions verification pending at report creation

## Authority and prior learning

Canonical main: 2342494f6581c167a5648681ca7374b26d6659d4. One open research PR #2286; preceding HEAD caca797010a6da91b529c02a9ceb05a456952ecf and CI #40485828847 SUCCESS. Read latest-main research-learning-loop and research-knowledge-retention contracts, relevant append-only LEARN records, main Experiment/Discovery and empty Rejection registry, merged PR #2285, and enabled research automation.

Reused LEARN-forward-vault-dirfd-reachability-preflight-toctou-20261027, LEARN-forward-vault-dirfd-ancestor-symlink-20261027 and LEARN-forward-vault-strict-readback-ancestor-test-assumption-20261027. This is a distinct **real-directory** replacement, not the previously tested symlink rejection or preflight-only TOCTOU.

- fingerprintKey: research-k3.forward-vault.real-ancestor-replacement-strict-path-readback
- attemptSignature: pr2286-v384-rename-real-ancestor-and-replace-with-real-decoy-dirfd-publish-strict-readback
- environmentKey: local-linux-python3-glibc+github-actions-linux-node24-python3
- materialStateKey: executor-sdk-v3/pr2286-v383-strict-ancestor-guard-v384-real-directory-substitution-fixture
- Gate: PROCEED_DISTINCT / REUSE_GUARDRAIL.

## Frozen disposable protocol

Test: src/research/governance/forwardEvaluationVault.dirfdRealAncestorReplacementLinux.test.ts  
Implementation commit: 45f172e63fe6dda103aa1238d692d796217914b4

1. Stage independent synthetic JSON objects at anchor/vault/staged.json and decoy/vault/published.json. Their writer fields differ but their caller-declared outputDigest fields are the same synthetic string; this declaration is not an authenticated payload digest.
2. Python opens trusted root, anchor and vault directory FDs component-by-component with O_DIRECTORY and O_NOFOLLOW. Rename anchor to moved, then rename the **real** decoy directory to anchor. The canonical pathname has no symlink.
3. Publish staged.json to published.json relative to the pinned vault FD with Linux renameat2(RENAME_NOREPLACE). Read via that same FD with O_NOFOLLOW, require exact anchored bytes, a regular file and nlink=1. Fsync the pinned vault and root.
4. Node verifies moved/published.json contains anchored JSON, canonical anchor/vault/published.json contains different decoy JSON, and both are single-link regular files under real directories. The existing verifyJsonReadback(path, expectedOutputDigest) accepts **both**: it checks real ancestors, file type, JSON parsing and a declared outputDigest field, not publisher-directory identity or a recomputed hash of the whole file.
5. Unsupported native renameat2/filesystem combinations skip. Only disposable fixture files are removed; no stale-path recovery or SDK changes are introduced.

## Observation and interpretation

A local disposable Linux/Python3/glibc reproduction of the real-directory rename sequence returned LOCAL_PROBE_PASS. The committed regression awaits official CI verification; do not infer CI PASS before that run finishes.

The prior ancestor-symlink rejection remains a correct existing guardrail. **Real-directory replacement is a different boundary:** a path-only strict reader can accept a different but structurally valid JSON object even while a pinned-FD writer and reader consistently address the original object. Matching caller-declared outputDigest strings are not independent evidence of common file identity. This is a candidate hybrid design counterexample, **not** evidence of a production exploit or a defect in the documented scope of the existing SDK.

## Falsifiers and decision

Falsifiers: pinned read returns decoy bytes, no-replace overwrites, decoy changes, canonical path reaches the original object, replacement is a symlink, or the strict reader rejects the valid real-directory decoy. Any red CI requires five-layer log triage.

**Reject** the assumption that pinned writer FD plus strict pathname reader establishes shared publisher/consumer identity. Require a separately reviewed common namespace authority, trust-root lifecycle and deterministic rename/mount concurrency fixtures. Do not weaken symlink checks, trust preflight-only reachability, auto-delete stale names, infer power-loss durability/native portability, or claim independent witness, correction completeness, clock/revocation, approved scoring, merge or production readiness.

No protected N2 activation, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, private raw T-5 odds/values, secrets or private paths.
