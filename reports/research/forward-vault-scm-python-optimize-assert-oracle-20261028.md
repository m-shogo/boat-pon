# Forward Vault: ambient Python optimization invalidates synthetic assert oracles (research-only)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**  
Date: 2026-10-28 JST  
Evidence stage: bounded source audit and isolated Linux/Python 3.13 optimization semantics probe. No production defect, real provider verification, scoring authority or readiness count.

## Authority and learning gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Sole open research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286), pre-change head `31dbecf473309b67de41372bf86e927d13bd04dd`. Pre-change [CI #40599886832](https://github.com/m-shogo/boat-pon/actions/runs/40599886832) completed SUCCESS: verify and research-governance jobs, all post-job steps successful. Read latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, and Forward Vault contract. Reviewed the five research-only SCM_RIGHTS/dirfd transfer fixtures, prior prehandoff ownership/decoder/errno/embedded-Python Learning records, merged #2284/#2285, and historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`. No relevant substantive Rejection is known; historical inventory is not forward evidence.

- `fingerprintKey=research-k3.forward-vault.scm-rights-ambient-python-optimize-assert-oracle`
- `attemptSignature=pr2286-v399-scm-five-fixtures-python-isolated-mode-nested-child-and-ambient-optimize-regression`
- `environmentKey=local-linux-python3.13-node22+github-actions-linux-node24-python3`
- `materialStateKey=pr2286-v398-five-scm-dirfd-fixtures-python-c-with-inherited-environment-assert-oracles`
- Learning gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**; no matching unchanged failure found. Reuse `LEARN-forward-vault-scm-rights-prehandoff-fd-leak-20261028`, `LEARN-forward-vault-scm-rights-session-premature-handoff-decode-20261028`, `LEARN-forward-vault-fd-lifetime-python-newline-fixture-20261028`, and `LEARN-forward-vault-scm-session-errno-import-fixture-20261028`.

## Falsifiable finding and minimal correction

The five synthetic Linux probes used `python3 -c` and relied on Python `assert` for safety-oriented acceptance/rejection checks. Python's ambient `PYTHONOPTIMIZE=2` disables those assertions; an assertion-only negative-control branch could print a success marker without executing its admission oracle. Isolated local probe: with `PYTHONOPTIMIZE=2`, `python3 -c 'import sys; print(sys.flags.optimize)'` printed `2`; `python3 -I -c ...` printed `0`. This demonstrates an environmental test-oracle hazard, **not** an observed false-green GitHub CI or production leak.

The five research-only fixtures now launch Python with `-I` (isolated mode), explicitly reject `sys.flags.optimize != 0` before test assertions, and apply `-I` to nested Python children in the transfer/admission fixtures. A new admission regression injects `PYTHONOPTIMIZE=2` for both a truncation denial and a nested peer-rejection path; both must retain their existing exact stdout and zero-exit contract. No native service, trust anchor, betting, or scoring implementation is added.

Falsifiers: either optimized environment disables a safety oracle, nested child loses isolation, existing positive/negative synthetic modes change behavior, Python fails unexpectedly, TypeScript/tests/build/governance/isolation turns red, or post-job cleanup fails. The official new-head CI must be checked separately; this report does not claim it passed before it finishes.

## Unresolved dependencies and next safe action

Independently authenticated sender/channel/directory bootstrap, external source-issued complete correction checkpoints and finality, trusted clock/revocation, prospective frozen cohort, exact ticket/refund settlement, approved v0.2 protocol, power-loss persistence and safe recovery remain **unresolved**. Existing provider capability and issuer evidence-request reports already define the external blockers; avoid redundant synthetic-positive verifier work until independent proof and rights are available. Next: confirm official latest-head CI, then audit remaining Python-based research probes for the same ambient optimization exposure without broad production edits.

Learning classification: **NEW_FAILURE**, retained in `LEARN-forward-vault-scm-python-optimize-assert-oracle-20261028`. Research/production isolation preserved: no protected N2 activation, Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, private raw T-5 values, secrets or private paths. **Do not merge.**
