# Forward Vault: complete bounded Python isolation across Linux research fixtures

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence: source-level invocation audit of the 18 PR-changed `forwardEvaluationVault.*Linux.test.ts` files; research-only, no production or scoring authority.

## Authority and learning

Latest canonical main `2342494f6581c167a5648681ca7374b26d6659d4`; sole open PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286), previous head `737907ddf637dcc09be2dca37281b578c9456188`. The first `-I` fix and injected-`PYTHONOPTIMIZE=2` parent/nested-child regression passed official [CI #40606755074](https://github.com/m-shogo/boat-pon/actions/runs/40606755074): verify **4,591 PASS / 2 SKIP / 0 FAIL** (4,593 total), research-governance SUCCESS, post-job cleanup SUCCESS. Read latest-main learning-loop and knowledge-retention contracts; reviewed prior Python fixture/FD Learning, independent-source blocker reports, merged #2284/#2285, and historical Experiment/Discovery lineage. No relevant substantive Rejection or new external authority was established.

- `fingerprintKey=research-k3.forward-vault.scm-rights-ambient-python-optimize-assert-oracle`
- `attemptSignature=pr2286-v400-complete-pr-linux-python-invocation-isolation-audit`
- `environmentKey=github-connector/github-actions-linux-python3`
- `materialStateKey=pr2286-v399-five-scm-dirfd-probes-isolated-remaining-thirteen-linux-probes-inherit-pythonoptimize`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuses `LEARN-forward-vault-scm-python-optimize-assert-oracle-20261028`; same root-cause class, no duplicate LEARN.

## Bounded audit and correction

Of 18 PR-changed Linux research fixture files, 5 SCM_RIGHTS/dirfd-transfer fixtures already launched Python with `-I`. The remaining **13** used `python3 -c` or `python3 -u -c` without isolation. All contain Python `assert` or assertion-dependent synthetic checks. Ambient `PYTHONOPTIMIZE` can suppress Python assertions and yield misleading negative-control output. No evidence shows the official runner used optimization or production was affected.

This patch adds `-I` to every non-isolated Python invocation in the remaining 13 files, preserving `-u` where present, original arguments, source strings, timeouts, stdout expectations, file/FD operations, and test semantics. The earlier commit's explicit optimization guard and injected-variable regression verify the mechanism. Completed code scope: **18/18 audited PR-changed Linux fixture files**; not a claim about all Python in the repository.

Falsifiers: any `python3 -c` or `python3 -u -c` without `-I` in the 18-file scope, changed test output, red Linux control, TypeScript/tests/build/governance/isolation, or failed post-job cleanup. New-head official CI must finish before claiming this expansion verified.

## Unresolved blockers and next action

Independently authenticated correction ordering/completeness/finality, trusted clock/key revocation, prospective cohort freeze, exact ticket/refund settlement, approved v0.2 protocol, authenticated directory provenance, power-loss durability and recovery remain unavailable. Prior issuer evidence-request report is the correct external dependency; do not simulate it with local metadata. Next: inspect latest-head CI, then limit further optimization audit to distinct Python entrypoints outside this 18-file scope.

Classification: **REUSED_LEARNING**; no new LEARN (same failure class). No protected N2 activation, Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, private raw T-5 odds, secrets or private paths. **DO_NOT_MERGE_CANDIDATE**.
