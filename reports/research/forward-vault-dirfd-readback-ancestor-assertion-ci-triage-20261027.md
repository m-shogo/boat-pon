# Forward Vault same-dirfd probe: strict ancestor readback assertion triage

Status: **TEST EXPECTATION CORRECTED / RESEARCH-ONLY / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-27 JST  
Evidence: full GitHub Actions job logs, existing SDK source, corrected regression and official green CI

## Authority and failure identity

Canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; one open research PR #2286. Latest-main learning-loop/knowledge-retention contracts, relevant dirfd and ancestor-symlink LEARN records, recent merged research PR #2285, and the enabled research automation were read. This incident is a **new test-expectation root-cause class**, not a new Linux filesystem failure and not a reason to retry a known failed preflight-only canonical-path guarantee.

- fingerprintKey: `research-k3.forward-vault.strict-readback-ancestor-symlink-test-assumption`
- attemptSignature: `pr2286-v383-assume-strict-sdk-accepts-symlinked-ancestor-decoy-json`
- environmentKey: `github-actions-linux-node24-python3-glibc`
- materialStateKey (failed): `executor-sdk-v3/pr2286-v383-initial-same-dirfd-fixture-incorrect-readback-expectation`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL` (reuse existing ancestor-symlink and canonical-reachability guardrails; correct the assertion, do not relax the SDK).

## Red CI: five-layer separation

Full verify job logs inspected for [CI #40484995440](https://github.com/m-shogo/boat-pon/actions/runs/40484995440) and [CI #40485059529](https://github.com/m-shogo/boat-pon/actions/runs/40485059529), both from the initial fixture expectation.

1. **Research payload:** The new synthetic same-dirfd test alone failed at the assertion that strict SDK `verifyJsonReadback` would return `ok=true` for the old `anchor/vault/published.json` pathname after `anchor` became a symlink. The test reported `false !== true`; other existing research tests were not implicated. The Linux native publication outcome itself was not shown to fail.
2. **Process exit:** Test command exited with code **1**; summary **4,560 tests, 4,557 PASS, 1 FAIL, 2 SKIP**.
3. **Workflow:** `verify` concluded **FAILURE**; `research-governance` concluded **SUCCESS**. Subsequent build/replay steps were skipped because the test command failed.
4. **Post-job:** Checkout cleanup and orphan-process cleanup completed. No post-job error explains the red conclusion; the test failure preceded cleanup.
5. **Runner/platform:** No runner outage or platform termination was evidenced in either full log. The Node.js 20 deprecation warning for actions forced onto Node 24 is not the cause.

## Root cause and corrected protocol

The initial fixture treated a raw `readFileSync` that follows a symlink ancestor and parses valid decoy JSON as if it implied the **strict** SDK reader would also accept that pathname. Source audit of `src/research/governance/executorSdk.ts` showed that `verifyJsonReadback` first invokes `assertRealDirectoryAncestors` and rejects a symlinked ancestor. This was a **false test assumption**, not a regression in the strict reader.

Corrective code commit: `3d0b5684c30fb6b20226d041e83483f08d9fff78`. The fixture now requires:

- Same-FD Python read returns the anchored JSON, regular file, single link;
- Raw pathname read follows the substituted ancestor to a different but valid decoy JSON;
- Existing SDK strict readback of the moved original directory **passes**;
- Existing SDK strict readback of the substituted ancestor **fails closed** with a parent-directory rejection;
- Decoy bytes remain unchanged, no SDK implementation or production path changes.

The companion research report was corrected in commit `9e6878115955a846414468e348af38ba8c34b02a` to remove the incorrect claim that both strict readbacks pass.

Official corrected-code [CI #40485208073](https://github.com/m-shogo/boat-pon/actions/runs/40485208073) **SUCCESS**: verify **4,560 tests / 4,558 PASS / 2 SKIP / 0 FAIL**, including the new test; Research Governance, typecheck, build, production isolation and post-job cleanup **SUCCESS**. The original red runs are retained as evidence, not hidden or rerun unchanged.

## Reusable guardrail and limits

**Inspect the actual strict reader contract before designing a negative test for a raw pathname read.** Keep the raw filesystem observation and SDK trust-boundary expectation separate; do not weaken `assertRealDirectoryAncestors` to make a test green. A pinned directory FD is object authority, not a guarantee that the old canonical pathname remains reachable. A safe future reader/writer API requires separately reviewed namespace identity, lifecycle, mount/rename concurrency, and power-loss durability.

Classification: **NEW_FAILURE** (test expectation mismatch) with corrected behavior verified. A digest-protected `LEARN-*` should preserve the root cause and guardrail. No production authority, approved scoring, independently authenticated evidence, Current BUY, LINE, public publishing, automated betting, Owner Dashboard, or protected N2 activation is inferred. No private raw T-5 odds/values, secrets or private paths are included.
