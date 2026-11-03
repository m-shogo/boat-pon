# Forward Vault — ambient NODE_OPTIONS in synthetic Node subprocess fixtures (2026-10-28)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only test-harness hardening; no production, scoring, provider authentication or readiness claim.

## Authority and prior-learning gate

Pre-write canonical main: 2342494f6581c167a5648681ca7374b26d6659d4. Sole open PR #2286, previous head 2f49e472d72c6092a29eeee5ed5cca64cd70aff8, previous official [CI #40612283851](https://github.com/m-shogo/boat-pon/actions/runs/40612283851) SUCCESS (verify 4,591 PASS / 2 SKIP / 0 FAIL; governance SUCCESS). Read latest-main research-learning-loop and research-knowledge-retention-contract, prior LEARN-forward-vault-scm-python-optimize-assert-oracle-20261028 and embedded-fixture lessons, historical EXP/DISC coverage lineage, Rejection inventory, merged PRs #2284/#2285, and the prior PR-scope audit.

- fingerprintKey: research-k3.forward-vault.node-child-ambient-node-options-preload-fixture-integrity
- attemptSignature: pr2286-v402-three-node-child-fixtures-preload-negative-control-and-sanitized-child-env
- environmentKey: local-linux-node22.16+github-actions-linux-node24-pending
- materialStateKey: pr2286-v401-three-node-spawn-fixtures-inherited-node-options-before-v402
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Python ambient-optimization learning is analogous but not the same mechanism; no identical prior Node preload learning was found. New failure class recorded in LEARN-forward-vault-node-child-ambient-options-preload-20261028.

## Question, method and observation

The previous 106-file PR-scope audit identified three non-Python Node subprocess fixtures. Do their spawn(process.execPath, ["-e", ...]) calls inherit ambient NODE_OPTIONS capable of executing an unrelated preload before the synthetic test script?

On disposable local Linux Node v22.16.0, created a harmless temporary CommonJS preload that prints PRELOAD, and spawned a child with NODE_OPTIONS set to --require the synthetic preload. **Control:** process exit 0, stdout exactly PRELOAD followed by CHILD on separate lines. **Sanitized:** remove NODE_OPTIONS from a copied child environment; process exit 0, stdout exactly CHILD, stderr empty. This demonstrates ambient preload execution and a bounded mitigation. It does **not** show a compromised CI runner or a prior false-green result.

## Change and verification boundary

Code commit [8e6bff89](https://github.com/m-shogo/boat-pon/commit/8e6bff89e285ff5a40bdca01ec514e268d2be36b) adds the test-only isolatedForwardVaultNodeChildEnv helper and a negative-control regression. Three research-only Node subprocess fixtures use the helper: concurrent publication, process termination and readback publication window. The source environment is not mutated. The test uses disposable synthetic files and does not touch an SDK writer, private data, or a production endpoint.

The exact GitHub test source and modified fixture were re-fetched after the commit. **Official code-head CI is pending/not yet observed at report authoring**; do not claim CI success until the actual latest-head workflow and logs verify this change. A future CI failure must be triaged by payload, process exit, job conclusion, post-job cleanup and runner evidence separately.

Falsifiers: a Node child still inheriting NODE_OPTIONS in these three fixtures, a failed negative control, a mismatched committed test source, or a new-head CI/typecheck/governance failure. This only removes one ambient Node option vector from child processes; parent runner startup, other environment variables, Node invocations outside these three files, external issuer trust, revision finality, cohort freeze, protocol approval and power-loss durability remain unproven.

## Decision and non-interference

Keep **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**. Independently authenticated source/correction/finality, rights, trusted time/revocation, exact settlement/refund adjudication, prospective frozen cohort and approved evaluation protocol remain blocked. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, dormant/protected N2, private raw T-5 odds, secrets or private paths were accessed or modified. Classification **NEW_FAILURE** (test-harness exposure), with append-only Learning; no research promotion.
