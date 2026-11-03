# Forward Vault: SCM_RIGHTS peer identity versus received directory capability binding

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: isolated Linux synthetic directory-FD admission negative control; no external trust, scoring, production bridge or recovery.

## Authority and prior learning

Canonical main at gate: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286). Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, main `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` (unrelated dataset evidence), empty main Rejection registry, merged #2285, and relevant Linux FD/SCM_RIGHTS/bootstrap Learning records. The hourly research automation remains enabled; Owner Dashboard is separately owned. Previously red CI #40547149643 was reviewed by full verify and governance job logs: five new fixture tests failed on source newline framing, test command exit 1 and verify FAILURE, research-governance SUCCESS, post-job cleanup completed, no runner-platform failure evidence. Its corrected successor #40547396287 was green.

- fingerprintKey: `research-k3.forward-vault.scm-rights-peer-vs-directory-object-binding`
- attemptSignature: `pr2286-v393-disposable-peer-only-decoy-vs-prepinned-object-denial-and-accept`
- environmentKey: `local-linux-node22-python3.13+github-actions-linux-node24-python3`
- materialStateKey: `pr2286-v392-scm-rights-peer-admission-v393-pinned-object-binding-fixture`
- Learning gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reuse `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-scm-rights-recvmsg-output-flag-mask-20261028`, `LEARN-forward-vault-pinned-root-late-child-bootstrap-20261027`, and the embedded-Python source escaping guardrail. This combines earlier peer admission and directory provenance boundaries; it is not a third unchanged attempt or a new independent authorization mechanism.

## Question and frozen synthetic protocol

Can a receiver with correct `SO_PEERCRED` identity still be handed a *different* valid directory FD, and can an explicitly pre-pinned synthetic directory identity distinguish the wrong object before payload access?

`src/research/governance/forwardEvaluationVault.scmRightsDirectoryBindingLinux.test.ts` runs three bounded, disposable Linux/Python cases. Each creates two separate directories containing distinct synthetic bytes, pre-opens the `authorized` directory as a **fixture-only assumed reference**, uses a local AF_UNIX socket pair and `SCM_RIGHTS` to transfer exactly one live directory FD, checks peer credentials, `MSG_CTRUNC`/unexpected flags, `MSG_CMSG_CLOEXEC` noninheritability, received FD count and directory type, then closes all received FDs.

1. **Peer-only negative control:** correct process credentials coexist with a decoy directory FD; reading through that unbound FD returns decoy bytes. This deliberately demonstrates a policy failure, not an accepted security implementation.
2. **Object-bound denial:** the same decoy FD differs in `fstat(st_dev, st_ino)` from the pre-pinned fixture reference; deny before opening any payload through the received FD.
3. **Object-bound positive control:** the received FD is the same pre-pinned fixture directory object; bounded FD-relative read returns the authorized synthetic bytes.

The test checks both source files remain unchanged and that received FDs are closed even after rejection. It does not open external paths, operate on mounts, use real research evidence, or mutate SDK/production settings.

## Observations, falsifiers, limitations

Local Linux Node 22.16 / Python 3.13: **3 PASS / 0 FAIL**, with local Git blob SHA `8625fbc3b612fafdd4f6af9cdcf9ab481779e5d2`. The GitHub source blob was fetched back and matched this SHA exactly after commit `6e868f948eff820bdddcd117a77aab7d48292f21`. Official GitHub Actions status must be checked separately; local pass is not official CI success.

Falsifiers: mismatched peer credentials, a decoy incorrectly matching the pre-pinned object, any read in the bound-denial case, unexpected ancillary flags, inheritable received FD, wrong bytes, leaked received descriptor, or red official CI.

**Scope limit:** `SO_PEERCRED` identifies a local process, not its authorization. The pre-pinned reference is a test assumption, **not** an independently authenticated trust root; `st_dev/st_ino` is not cryptographic provenance and does not establish durable identity, correct initial bootstrap, future pathname reachability, mount namespace invariance, power-loss persistence, safe recovery or source authenticity. The synthetic positive case grants no production readiness, scoring or merge authority.

Existing blockers remain: independently authenticated directory bootstrap and sender authorization, capability lifecycle, mount/rename races, power-loss durability, safe recovery, independent witness and settlement correction completeness, trusted clock/revocation, prospective frozen cohort and approved v0.2 evaluation protocol. **No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2 or private raw T-5 evidence was accessed or changed.**

Next: test an authenticated *lifecycle-bound* handoff contract only if an independent trust-anchor specification becomes available; otherwise audit same-process/multiple-connection capability substitution and close-on-reject behavior without claiming source authentication. No native production bridge, automatic recovery, fallback pathname reader or merge.
