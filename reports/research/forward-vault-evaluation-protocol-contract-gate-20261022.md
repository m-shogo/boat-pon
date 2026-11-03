# Forward Vault evaluation protocol coverage gate (2026-10-22)

Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE. Research-only, no production authority.

Authority: main `2342494f6581`; PR #2286 `5fb475ffda60`; canonical `docs/architecture/forward-evaluation-vault.md` and `docs/architecture/outcome-learning-ledger-contract.md`. PR code: `src/research/governance/forwardEvaluationVault.ts` blob `7fbdd283f8d1`, schema blob `97d055684405`. CI run 39715131483 passed, but it validates existing checks only.

## Verified coverage gap

The v0.1 EvaluationProtocol stores metricFamilies, comparisonMode, oddsBasis, unresolvedPolicy, benchmarkDecisionSystems and protocolVersion, but has no explicit frozen metric formulas, stake/return/refund/void semantics, max-hit-removed reporting rule, minimum sample/grouping policy, or exclusion-reason taxonomy. The RESULT stores only total included/excluded counts and an arbitrary finite-number metrics map. A digest match does not prove that a protocol covers those missing semantics.

The runtime matcher validates record shape, digest, metric family, stage, odds basis, comparison mode and protocol.createdAt < result.createdAt. It does not receive decision, enrollment, settlement or source-manifest records, so it cannot prove prospective freeze before evaluated decisions, EXACT outcome reconciliation, finality/evaluable status or a common-cohort denominator. No real outcome corruption or ROI is inferred.

## Required next safe slice

1. Specify a separate versioned protocol (candidate 0.2) rather than reinterpreting 0.1 digests: explicit formula/units, refund/void monetary rules, denominator, max-hit removal, sample/grouping and exclusion reasons.
2. Add synthetic cross-ledger negative fixtures for REFUNDED, VOID, REVISED, unresolved finality, mismatched ticket/decision, protocol-after-decision, and selected-race vs common-cohort differences. Keep non-evaluable evidence retained but unscored.
3. Implement a distinct fail-closed scoring-admission gate requiring independently verified EXACT final outcomes and prospective protocol/enrollment, not merely `resultMatchesProtocol`.
4. Run TypeScript, governance, isolation and full CI on the new PR HEAD; verify source manifest identities and read back writes before merge. Do not assert readiness counts.

Reused prior Learning: `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-forward-vault-unresolved-vs-refund-policy-20261019`, `LEARN-forward-vault-protocol-admission-failclosed-20261014`, `LEARN-github-write-readback-20260918`. No new failure fingerprint is claimed.

Learning: REUSED_LEARNING / NO_NEW_LEARNING.
fingerprintKey: research-k3.forward-vault.evaluation-protocol-contract-coverage
attemptSignature: pr2286-v0.1-schema-runtime-contract-matrix-durable-governance-finding
environmentKey: github-connector-read+official-actions
materialStateKey: forward-vault.0.1/schema-97d05568/runtime-7fbdd283/pr-5fb475ff

This is a governance finding, not a scored evaluation, readiness claim, promotion or production change.
