# Forward Vault: actual Linux openat2 EAGAIN under bounded concurrent real-directory rename

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
Date: 2026-10-27 JST
Evidence stage: disposable synthetic Linux kernel concurrency observation, official CI verified; **no production, scoring or merge authority**.

## Authority, lineage and learning gate

Canonical main at start and before this write: 2342494f6581c167a5648681ca7374b26d6659d4. Open PR: #2286, the only open PR. Earlier v386 openat2 trust-root report and LEARN-forward-vault-openat2-trust-root-mount-boundaries-20261027 were retrieved, along with v385 check-to-open race and v381 ancestor-symlink learnings. Latest-main docs/architecture/research-learning-loop.md and docs/architecture/research-knowledge-retention-contract.md were read. Main EXP-dataset-expand-701398c2 and DISC-dataset-coverage-701398c2 are unrelated inventory lineage; no Rejection records exist on main. Merged PR #2285 remains the unchanged core authority. Active hourly research automation was checked; Owner Dashboard work was excluded.

- fingerprintKey: research-k3.forward-vault.openat2-real-concurrent-rename-eagain
- attemptSignature: pr2286-v388-bounded-kernel-rename-8000-openat2-attempts
- environmentKey: github-actions-linux-node24-python3-openat2-syscall437
- materialStateKey: executor-sdk-v3/pr2286-v387-injected-eagain-v388-bounded-kernel-rename
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. The earlier EAGAIN adapter-injection policy was reused; this is a distinct real-kernel interleaving, not an unchanged failed retry.

## Fixed question and protocol

Question: can Linux openat2 actually return EAGAIN under bounded concurrent rename with parent traversal, while a fail-closed research observer refuses all uncertain opens and never accepts unexpected bytes?

Test: src/research/governance/forwardEvaluationVault.openat2ConcurrentRenameLinux.test.ts. Initial commit b8f96ff033df0255f9ac426110b37d4f493c428d; aggregate diagnostic commit 24d63379a563a9e771a1002b8333f60a5a07fb0e. Python ctypes invokes Linux syscall 437 (supported x86_64/aarch64), with a pinned disposable root FD, RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV, and the relative path anchor/../anchor/vault/published.json. A separate thread repeatedly renames the same real anchor directory to moved and back inside that disposable root.

Exactly **8,000** independent openat2 attempts are made. Each successful open is checked for original synthetic bytes, regular-file mode and single-link identity; EAGAIN, ENOENT and EXDEV are counted as denied (no read, fallback, retry or cleanup). Unexpected errors, wrong bytes, incomplete count, failed thread shutdown, or changed original JSON fail the test. The test **does not require any positive EAGAIN count**: kernel scheduling is nondeterministic and a zero count is not evidence of impossibility. It performs no mount operation or protected N2 activity.

## Official observed evidence

[GitHub Actions CI #40509724807](https://github.com/m-shogo/boat-pon/actions/runs/40509724807), latest test HEAD 24d63379a563a9e771a1002b8333f60a5a07fb0e: **SUCCESS**. Full verify log shows the named new test executed and passed, with aggregate diagnostic:

| openat2 outcome | Observed attempts |
|---|---:|
| Valid original JSON read | 3,060 |
| EAGAIN — uncertain resolution, denied | **131** |
| ENOENT — absent during rename, denied | 4,809 |
| EXDEV — denied | 0 |
| Total bounded attempts | **8,000** |

All 131 EAGAIN outcomes were returned by the **real kernel syscall**, unlike the preceding deterministic injection-only policy fixture. The test has no unbounded retries, no unsafe pathname fallback and no decoy acceptance. Aggregate counts are a single CI-run observation, **not readiness counts, probabilities, reliability estimates, or a guaranteed reproduction rate**.

Suite totals: **4,567 tests / 4,565 PASS / 2 SKIP / 0 FAIL**. TypeScript and build succeeded; Research Governance succeeded; all post-job checkout/setup cleanup completed successfully. Error strings from unrelated expected negative-input tests are not workflow failures. Research payload PASS; test process exit zero; verify and governance jobs SUCCESS; post-job infrastructure SUCCESS; no external runner/platform fault demonstrated.

The preceding injected EAGAIN contract passed [CI #40508805918](https://github.com/m-shogo/boat-pon/actions/runs/40508805918) and its report-head CI #40509534952 succeeded. This run therefore separates deterministic policy testing from actual kernel observation.

## Interpretation, falsifiers and unresolved authority

**Bounded verified success:** under this Linux environment, concurrent real-directory renaming and parent traversal produced real openat2 EAGAIN. Treat that error as **indeterminate and denied**, not as permission for unbounded retry or weaker pathname fallback. Preserve the earlier result that a trusted root FD and traversal flags do not themselves authenticate a mutable intermediate directory name.

Falsifiers include any accepted non-original bytes, unexpected errno, changed file/link count, unbounded loop, unclosed thread, skipped test counted as executed, or red official CI. The specific EAGAIN count is **not** a pass condition.

This does **not** prove that EAGAIN always occurs under rename, that a production reader is safe, that an independently trusted publisher identity or canonical path is stable, or that power-loss durability and safe recovery are solved. The existing SDK and all callers remain unchanged. Independent witness and source finality, complete correction lineage, trusted clock/revocation, frozen prospective cohort and approved v0.2 evaluation protocol remain missing.

No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, dormant/protected N2, private raw T-5 odds, private values, secrets or private paths were touched.

Next safe step: independently specify a common pinned reader/writer directory-object authority and compare it against canonical-path reachability under bounded real-directory and mount changes. Do not implement a native production bridge, automatic stale-path deletion or scoring.
