# Forward Vault: pinned root FD does not authenticate a late-pinned child directory

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence stage: disposable synthetic Linux directory-object provenance probe; local Node/Python test verified, official CI pending at initial report write. **No merge, scoring, production or recovery authority.**

## Authority and learning gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Only open PR: [#2286](https://github.com/m-shogo/boat-pon/pull/2286), research-only. Latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md` read. Related learning retrieved: `LEARN-forward-vault-openat2-trust-root-mount-boundaries-20261027`, `LEARN-forward-vault-real-ancestor-replacement-strict-readback-20261027`, `LEARN-forward-vault-strict-reader-check-open-race-20261027`, and `LEARN-forward-vault-openat2-real-rename-eagain-20261027`. The main EXP/DISC dataset-coverage lineage is unrelated; main has no Rejection record. Merged #2285 is the canonical Forward Vault core. The active hourly research automation is separate from Owner Dashboard.

- fingerprintKey: `research-k3.forward-vault.pinned-root-late-child-bootstrap-provenance`
- attemptSignature: `pr2286-v389-pinned-root-late-child-bootstrap-unguarded-vs-identity-denial`
- environmentKey: `github-actions-linux-node24-python3-renameat2+local-linux-node22-python3`
- materialStateKey: `executor-sdk-v3/pr2286-v388-rootfd-openat2-and-dirfd-synthetic-namespace`
- Learning gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Prior path-swap and `openat2` limitations are reused. This distinct probe tests **bootstrap timing and self-consistent wrong-object agreement**, not another retry of the same failed pathname read.

## Fixed question, protocol and controls

Question: does keeping a trusted root directory FD and sharing the subsequently pinned final-directory FD between writer and reader authenticate that final directory, if a mutable real child name is replaced **before** the final FD is acquired?

The new `src/research/governance/forwardEvaluationVault.pinnedRootBootstrapLinux.test.ts` runs two deterministic disposable Linux cases. Both create an original synthetic `anchor/vault` and an unrelated real `decoy/vault` with distinct complete JSON. The root FD and simulated previously authorized final-directory FD are opened before the rename; the original `anchor` is moved and the decoy real directory takes its name. A new final FD is then opened **relative to the same pinned root FD**. Its `st_dev/st_ino` differs from the previously pinned original final FD.

1. **Unguarded late pin:** `renameat2(RENAME_NOREPLACE)` publishes the decoy's staged JSON relative to the late-pinned FD. Reading relative to that same FD returns the decoy's complete single-link regular JSON. Writer and reader agree with each other, but not with the previously authorized directory object. The original staged JSON remains unchanged and unpublished.
2. **Identity-denial control:** compare the late-pinned final FD's `st_dev/st_ino` to the simulated previously authorized final-directory identity **before publication**. On mismatch, deny; both staged JSON files remain and neither published file exists.

The test uses no mount operations, real source evidence, recovery, production writer, SDK change or protected N2. Unsupported Linux `renameat2` is skipped explicitly, never counted as executed. Both tests use a bounded Python child process and disposable synthetic directories. The simulated authorization is test setup, **not a proposal to trust unverified pathname `stat` in production**.

## Observation and falsifiers

Local `node --experimental-strip-types --test` with Node 22 and Python 3.13 on Linux: **2/2 PASS, 0 FAIL**. Initial GitHub test commit: `69736e5305516d50e4333d5879ddb21522fc7c9f`. Official CI [#40516942836](https://github.com/m-shogo/boat-pon/actions/runs/40516942836) was queued when this report was written; verify its final job/log outcome independently before claiming official success.

Falsifiers: wrong or partial JSON accepted, unexpected rename error, a guard-mode publication, original staged bytes altered, decoy link count other than one, skipped test counted as passed, or red CI. The test does not assert performance, production readiness, external source authenticity, or the ability to authenticate a directory after its identity is lost.

**Bounded finding:** a pinned **root** traversal boundary plus reader/writer agreement on a late-pinned **child** FD is insufficient to prove previously authorized publisher-object identity. A preauthorized final-directory identity can detect this deterministic replacement **at the comparison point**, but `st_dev/st_ino` alone is not a durable cryptographic identity, cannot close subsequent rename/mount windows, and cannot establish trusted provenance without an independently reviewed bootstrap and lifecycle.

Independent witness and source finality, trusted clock/revocation, correction completeness, frozen prospective cohort, approved v0.2 protocol, power-loss durability and safe recovery remain blocked. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2 or private raw T-5 values/paths were accessed or changed.

**Next safe step:** specify an independently anchored final-directory authority/lifecycle and test a post-comparison swap without treating a successful identity check as a durable reachability guarantee. Do not add auto-recovery, stale-path deletion, native production bridge or scoring.
