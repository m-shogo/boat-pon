# Forward Vault max-hit/common-cohort policy freeze gate (2026-10-24)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**. Research-only governance finding; **no scoring, promotion or production authority**.

## Authority and verification

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Existing research PR: #2286; synthetic test commit `7aff0e92063d1bec9148136119ccb39348caeca8`.
- Test: `src/research/governance/forwardEvaluationVault.maxHitCohortCounterfactual.test.ts`.
- Official PR CI: run `40000152216`, **verify SUCCESS** and **research-governance SUCCESS**; 4,205 tests, 4,203 pass, 2 skip, 0 fail. All six new synthetic cases were observed in the verify job log.
- No real cohort, private odds, live settlement, N2 diagnostic activation or actual ROI was used.

## Two independent ambiguities in v0.1

1. **What is one max-profit event?** In the same synthetic three-race/two-ticket-per-race universe, removing the highest-net-profit **decision record** yields A +80% and B -20%, whereas removing the highest-net-profit **whole race** yields A -25% and B 0%. This is a *ranking reversal* caused solely by the event unit, not evidence of a profitable system.
2. **Must the excluded race align between systems?** After fixing the event unit to `CANONICAL_RACE`, independent per-system max-profit removal can exclude different races. In the synthetic alignment fixture, A excludes `shared-race-2` and B excludes `shared-race-1`. The retained race sets then differ even though the initial cohort is identical. A single shared predeclared exclusion preserves common race membership but defines a *different* statistic.

All synthetic sensitivity outputs explicitly carry `scoringAuthorized: false`. The fixtures use integer-yen inputs and BigInt rational ROI comparisons, subtract both stake and payout, reject zero denominators, duplicate decision IDs and invalid monetary inputs, and use a deterministic tie-break. Those are **test hypotheses**, not an approved v0.2 policy.

## Frozen v0.2 decisions required before any scoring gate

- Declare the max-hit event identity (`DECISION_RECORD` vs `CANONICAL_RACE` or another reviewed unit), grouping, deterministic tie-break, and handling when no positive-net event exists.
- Declare whether system-specific exclusions are **separate sensitivity reports** or a **shared, prospectively fixed exclusion** is used for direct common-cohort comparisons. Never relabel different retained race sets as one common-cohort comparison.
- Freeze monetary units, stake and payout treatment, refund/void/cancelled/unresolved exclusion taxonomy, denominator and zero-denominator behavior, and grouping/minimum sample before outcomes are known.
- Require independently verified EXACT final settlement, outcome evaluability, decision/ticket identity, point-in-time enrollment, immutable cohort membership, source-manifest digest and stage separation. A caller-supplied reconciliation flag or v0.1 result digest alone cannot establish these.
- Introduce a separately versioned v0.2 protocol and schema. Do **not** reinterpret existing v0.1 digests or authorize scoring through the synthetic test helper.
- Preserve the research/production boundary: no Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard or protected N2 activation changes.

## Lineage and falsifiability

Related contracts: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `docs/architecture/forward-evaluation-vault.md`, `docs/architecture/outcome-learning-ledger-contract.md`.

Prior findings: `reports/research/forward-vault-evaluation-protocol-contract-gate-20261022.md`; PR #2286 discussion on synthetic v272/v273 event-unit and exclusion-alignment counterexamples. Reused learning: `LEARN-forward-vault-protocol-admission-failclosed-20261014`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-github-write-readback-20260918`.

Falsification route: prospectively freeze a reviewed v0.2 exclusion rule, independently prove equal eligible and retained race identities and applicable denominators for the intended comparison, then test with independently reconciled final synthetic evidence before any real evaluation is proposed. The current fixtures **do not** prove equality of ticket stakes, selections, result eligibility, or evaluator readiness.

Learning classification: **REUSED_LEARNING / NO_NEW_LEARNING**. No new failure root-cause class is asserted.

- fingerprintKey: `research-k3.forward-vault.maxhit-event-unit-and-common-cohort-alignment`
- attemptSignature: `pr2286-v278-integrate-v272-v273-synthetic-negative-fixtures-and-ci-proof`
- environmentKey: `github-pr-ci-node24+node22.16.0-offline-replay`
- materialStateKey: `forward-vault.0.1/pr2286-7aff0e92/synthetic-maxhit-alignment-fixtures`
- learning gate: `PROCEED_DISTINCT_INTEGRATION / REUSE_PRIOR_FAIL_CLOSED_GUARDRAILS`

**Merge gate remains blocked** pending a reviewed v0.2 contract and independent source evidence; green CI verifies the negative fixtures, not evaluation readiness.
