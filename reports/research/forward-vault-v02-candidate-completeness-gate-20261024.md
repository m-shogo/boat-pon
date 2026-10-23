# Forward Vault v0.2 candidate completeness preflight (2026-10-24)

Status: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**. Research-only design check; no scoring, promotion, or production authority.

## Authority and scope

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Existing research PR: #2286, head at this report's preparation `61eca48dcad52958142ab030dd78fb0df5a4ffd6`.
- New isolated preflight: `src/research/governance/forwardEvaluationProtocolV02Candidate.ts`.
- New negative fixture suite: `src/research/governance/forwardEvaluationProtocolV02Candidate.test.ts`.
- Source authority: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `docs/architecture/forward-evaluation-vault.md`, existing v0.1 runtime/schema and the PR's max-hit/common-cohort gate report.
- No v0.1 record, digest, scorer, production integration, Current BUY, LINE, Owner Dashboard, public publishing, automated betting, settings, or protected N2 workflow was changed.

## Concrete implementation

The candidate preflight demands explicit unapproved version/status, one ROI formula ID and SHA-256-shaped formula reference, integer-JPY stake/payout/refund/void/cancellation/unresolved policy, max-profit event unit, deterministic tie-break, no-positive-event and zero-denominator semantics, prospective shared exclusion alignment, sample minima and grouping, exclusion taxonomy, benchmark systems, stage isolation and independent evidence requirements.

It rejects unknown fields, accessors, symbol fields, non-JSON arrays, missing taxonomy, malformed timestamps, zero/unsafe sample minima, and the particularly misleading combination `COMMON_COHORT + SYSTEM_SPECIFIC_SENSITIVITY_ONLY`. A shared predeclared race exclusion requires `CANONICAL_RACE` event identity. The previously verified mutable `Array.prototype.includes` admission guardrail is reused via own-entry checks.

**Every return has `scoringAuthorized: false`.** Even `candidateComplete: true` means only that a proposed contract is syntactically explicit and internally coherent; it does **not** mean its formulas or policies have been approved or its source evidence independently verified.

The minimum sample value in the synthetic fixture is an illustrative *configuration input*, not an observed cohort/readiness count or an approved threshold. The formula digest is shape-checked but is **not independently bound to an authoritative formula registry**. The module does not compute ROI, prove prospective enrollment, verify source-manifest bytes, reconcile settlement finality, validate equal eligible stakes, or authorize a scorer.

## Required before a frozen v0.2 contract

1. Review and approve ROI units/formula, integer rounding, refund/void/cancelled and revised outcome policy, sample/grouping thresholds, and the full exclusion taxonomy.
2. Decide whether max-hit removal is by decision/ticket or whole race; prospectively freeze common-exclusion alignment and retain separate labels for system-specific sensitivity statistics.
3. Introduce independently verified formula-registry and source-manifest digests, decision/outcome identities, EXACT final settlement, PIT/prospective enrollment and stage-specific cohort proof. Caller assertions cannot substitute for this evidence.
4. Add an independently versioned v0.2 schema, canonical digest, append-only records and cross-ledger negative fixtures; keep existing v0.1 identities immutable.
5. Verify new PR-head TypeScript, tests, research-governance, secret scan, production-isolation and CI before any merge consideration. A green CI is not evaluation authorization.

## Concurrent natural-workflow audit (no N2 diagnostics)

The latest natural Feature Rollup run #40003695814 ended **FAILURE**, but its 228-line job log shows a valid research summary `NO_CHANGE` / `PRIVATE_DAILY_PLAN_NOT_AVAILABLE`, a successful payload step and successful checkout/setup-node post-job steps. The job conclusion was red after the approximately ten-minute job interval. The precise runner/platform cause is **unclassified**; this is not proof of a research payload error.

The latest natural Daily Readiness run #40005501493 ended **FAILURE** with only an incomplete setup-step summary; its job log retrieval returned 404 `BlobNotFound`. Its research payload and process exit cannot be established from that run. The earlier independently inspected #39834565537 did have `DAILY_PLAN_MISSING`, exit 3 and successful checkout cleanup; **do not project that cause onto the newer logless job**.

Both new red observations match the existing `LEARN-actions-self-hosted-ten-minute-red-jobs-20261008` unclassified fingerprint. No protected N2 rerun was used; the guardrail remains observe-only. No new root-cause Learning is claimed.

## Learning gate

- classification: `REUSED_LEARNING / NO_NEW_LEARNING`
- fingerprintKey: `research-k3.forward-vault.v02-candidate-contract-completeness`
- attemptSignature: `pr2286-v280-typescript-v02-candidate-deny-first-explicitness-and-synthetic-negatives`
- environmentKey: `github-pr-node24-research-ci`
- materialStateKey: `forward-vault.0.1/pr2286-v02-candidate-isolated-no-scoring`
- gate: `PROCEED_DISTINCT_DESIGN_VERIFICATION / REUSE_VERIFIED_GUARDRAIL`
- reused: `LEARN-forward-vault-prototype-includes-admission-20261023`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-actions-self-hosted-ten-minute-red-jobs-20261008`, `LEARN-github-write-readback-20260918`
- new LEARN: none; no novel failure root cause or independently verified scoring success.

This is a durable governance finding and a candidate contract test, not an evaluated real dataset, approved metric protocol, readiness claim or merge approval.
