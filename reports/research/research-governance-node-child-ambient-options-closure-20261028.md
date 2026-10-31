# Research governance — Node subprocess ambient-option closure beyond Forward Vault (2026-10-28)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only test-harness correction; no production or scoring authority.

## Authority, scope and learning gate

- Canonical main before change: `2342494f6581c167a5648681ca7374b26d6659d4`. Sole open PR #2286, pre-change head `24ab739ccb8e5feb43f173a4ea16d7b904c8f253`.
- Latest pre-change official CI [#40618916899](https://github.com/m-shogo/boat-pon/actions/runs/40618916899) SUCCESS: verify 4,592 PASS / 2 SKIP / 0 FAIL, research governance SUCCESS, typecheck/build and post-job cleanup SUCCESS. This is **not** a claim about the new commit.
- Read latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `docs/architecture/forward-evaluation-vault.md`; PR Learning `LEARN-forward-vault-node-child-ambient-options-preload-20261028`, prior Python audit, EXP-dataset-expand-701398c2 and DISC-dataset-coverage-701398c2; the Rejection registry contains no substantive record. Reviewed recent merged PRs #2284/#2285.
- `fingerprintKey=research-k3.research-governance.node-child-ambient-options-preload-other-fixtures`
- `attemptSignature=pr2286-v403-audit-113-research-governance-test-files-and-isolate-five-other-node-launchers`
- `environmentKey=local-linux-node22.16+github-actions-linux-node24-pending`
- `materialStateKey=pr2286-v402-three-forward-vault-node-spawns-isolated-five-other-node-launchers-inherited-options`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT_SCOPE**. Same root cause as prior Node preload Learning, newly located in five previously unmodified research-governance tests. No new LEARN or repeat of an unchanged failed method.

## Concrete source inventory and negative control

Fetched the PR-head blobs for all **113** `src/research/governance/*.test.ts` files and searched for direct Node/Python subprocess launch markers. Three Forward Vault Node spawn fixtures already used `isolatedForwardVaultNodeChildEnv`; one dedicated negative-control test intentionally exercised inherited `NODE_OPTIONS`. Five other Node child launchers had no explicit environment isolation:

1. `canonicalRequestSafeRead.test.ts` — `execFileSync` canonical-request validator.
2. `requestGuardSafeRead.test.ts` — `execFileSync` safe UTF-8 reader.
3. `requestReplayDirectorySafeRead.test.ts` — `execFileSync` directory listing.
4. `runtimeDecisionLedgerBoundedCommand.test.ts` — `execFileSync` bounded synthetic shadow report.
5. `runtimeDecisionLedgerShadowDateCli.test.ts` — `spawnSync` date validation before DB access.

Other matched Python fixture execution sites were already isolated with `python3 -I`; `python3 --version` probes are availability-only. This is a bounded static test-file inventory, not a repository-wide dynamic process-launch guarantee.

Local disposable Linux Node 22.16.0 `execFileSync` negative control: with a harmless synthetic `NODE_OPTIONS=--require=<temporary preload>`, stdout was `PRELOAD` then `CHILD`; with `NODE_OPTIONS` removed from a copied environment, stdout was only `CHILD`. The injected source environment remained unchanged. This is an environment-inheritance demonstration, not evidence of CI compromise or prior false-green tests.

## Implementation and falsifiers

Add shared `isolatedResearchNodeChildEnv` for research-governance child fixtures; keep the existing Forward Vault helper as a compatibility wrapper. Apply the shared helper to the five identified Node subprocess launch sites, and add an `execFileSync` preload negative-control regression. No production code or CLI implementation changes. Synthetic fixture DB and file paths remain disposable; no private data is committed.

Falsifiers: any of the five child launchers still inheriting `NODE_OPTIONS`, the new `execFileSync` negative control failing, existing safe-reader/ledger/date tests regressing, a GitHub source read-back mismatch, or new-head TypeScript/test/governance/production-isolation CI failure. The parent runner and other ambient environment variables remain outside this mitigation.

## Decision and next safe action

Remain **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**. Independently provisioned witness/settlement issuer trust, source correction completeness/finality, clock/revocation, exact ticket/refund semantics, prospective cohort freeze and approved evaluation protocol remain unresolved. Do not infer readiness counts or scoring permission from test green. Prior K-provider written-evidence request remains the appropriate external dependency; do not re-scrape pages or invent a trusted issuer.

No Current BUY, LINE, automated betting, public publishing, production behavior/settings, Owner Dashboard, dormant/protected N2, raw private odds, secrets or private paths were accessed or changed. **Learning classification: REUSED_LEARNING**; reused `LEARN-forward-vault-node-child-ambient-options-preload-20261028`, no new record for the same cause. New-head official CI must be checked separately.
