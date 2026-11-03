# Forward Vault: Linux SCM_RIGHTS receiver admission and peer identity negative controls

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
Date: 2026-10-28 JST
Evidence stage: isolated Linux synthetic AF_UNIX descriptor handoff; not production, scoring, authentication authority or recovery.

## Authority and learning gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286). Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, recently merged PR #2285, existing `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` (unrelated historical coverage, no filesystem authority), and relevant `LEARN-forward-vault-linux-fd-exec-scm-rights-lifetime-20261028`, `LEARN-forward-vault-closed-dirfd-number-reuse-20261028`, and `LEARN-forward-vault-fd-lifetime-python-newline-fixture-20261028`. No protected N2 attempt or activation.

- fingerprintKey: `research-k3.forward-vault.scm-rights-receiver-admission-and-peer-credentials`
- attemptSignature: `pr2286-v392-disposable-ancillary-truncation-multi-fd-cloexec-and-real-child-peer-credentials`
- environmentKey: `local-linux-node22-python3+github-actions-linux-node24-python3`
- materialStateKey: `pr2286-v391-live-scm-rights-lifetime-v392-receiver-denial-and-peer-policy`
- Learning gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. The previous successful transfer was a capability-lifetime demonstration, not admission validation. Reuse the close-on-exec and owned-FD guardrails; never reuse a stale numeric FD or the earlier embedded-Python newline fixture.

## Fixed question and synthetic protocol

Can a receiver distinguish a truncated ancillary control message, multiple transferred descriptors, a single descriptor protected by `MSG_CMSG_CLOEXEC`, and a peer that fails a process-identity policy, without accessing private research data or changing production?

The isolated regression `src/research/governance/forwardEvaluationVault.scmRightsAdmissionLinux.test.ts` invokes bounded Python subprocesses from Node, creates only temporary synthetic directories and text, and checks five cases:

1. Send four FDs into an undersized ancillary buffer: `MSG_CTRUNC` must be detected and the partial received FD set rejected/closed.
2. Send two FDs with sufficient buffer: the unexpected multiplicity must be rejected and both descriptors closed.
3. Send one FD with `MSG_CMSG_CLOEXEC`: the received FD must be non-inheritable, and a controlled FD-relative synthetic read succeeds.
4. Connect a real subprocess to an AF_UNIX listener and compare `SO_PEERCRED` PID/UID/GID with the expected child identity before the synthetic read.
5. Supply an intentionally mismatched expected PID: reject without opening the synthetic payload through the transferred descriptor.

The test does not mount, mutate production, change the SDK, delete recovery artifacts, send external traffic or access raw T-5 odds. Its authorization comparison is a **fixture-only process-identity policy**, not a trust root or an authenticated sender allowlist.

## Observations and limits

Local Linux Node 22 / Python 3.13 after correction: **5 PASS / 0 FAIL**. `MSG_CTRUNC` and multiple-FD denial, `MSG_CMSG_CLOEXEC` noninheritability, real connecting-child `SO_PEERCRED` identity, and synthetic wrong-expected-PID denial were exercised. All received descriptors are explicitly closed and synthetic source content remains unchanged.

**Fixture-level anomaly:** the initial local test incorrectly asserted `recvmsg` output flags must be zero. On this Linux/Python environment, output flags include `MSG_CMSG_CLOEXEC` (the input flag) even on an otherwise valid receive. The corrected check masks the known input flag while still rejecting `MSG_CTRUNC` and unexpected bits, and verifies `os.get_inheritable(fd) == False` directly. This is a non-obvious receiver-side test guardrail, not a production incident. The GitHub connector file creation initially doubled source newline escapes; a follow-up commit corrected them using the previously retained Python-source fixture guardrail. Do not retry the broken framing.

Falsifiers: absent `MSG_CTRUNC` under the fixed undersized buffer, accepting multiple FDs, inheritable received FD after `MSG_CMSG_CLOEXEC`, peer credential mismatch in the positive control, access to the synthetic payload after intentional peer rejection, or failure of official CI. Counts are synthetic tests, not readiness counts.

**Official GitHub Actions verification must be read from completed workflow/job results; local green alone does not authorize a VERIFIED_SUCCESS claim.** Peer credentials do not establish independent application authorization, initial directory provenance, path reachability, namespace/mount safety, power-loss durability, safe recovery, independent witness/settlement correction completeness, trusted clock/revocation, frozen prospective cohort or approved evaluation protocol. Do not merge solely on green CI.

**No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2, private raw evidence or scoring authority changed.**

Next: evaluate authenticated bootstrap and lifetime-bound receiver policy in isolated synthetic fixtures; do not create a production native bridge, fallback pathname reader or automatic recovery.
