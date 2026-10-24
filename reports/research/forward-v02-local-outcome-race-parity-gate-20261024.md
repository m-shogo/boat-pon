# Forward Vault v0.2 local outcome-race parity gate (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, synthetic, deny-only evidence. No ROI scoring, approved evaluation, independent settlement authentication, prospective cohort attestation, or production authority.

## Authority and verification

- Canonical `main` inspected: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Existing research PR: #2286; no second PR or protected N2 run.
- Code commit: `1a8e759978fa843f3a02b1deaafc7fd6808ed489`; tests commit: `dad59f00926dc2e1aa35817a818cec265c857403`.
- Files: `src/research/governance/forwardV02LinkedBuyRaceParity.ts` and `src/research/governance/forwardV02LinkedBuyRaceParity.test.ts`.
- Official PR CI for test HEAD: Actions run **40047668998**, `verify` **SUCCESS**, `research-governance` **SUCCESS**, **4,274 tests / 4,272 pass / 2 skip / 0 fail**. The verify job log explicitly executed all **9 new synthetic tests**.
- The PR change scope remains restricted to research governance/config/registries/reports; existing Learning records remain append-only.

## Why linked BUY race parity is insufficient

A pair of models may have the same linked BUY race IDs and fully consistent caller-provided Decision/Outcome/Source Manifest digests, yet one model's ticket is `REFUNDED` or otherwise not locally evaluable while the other's is `FINAL/SETTLED/evaluable`. Calling those identical **locally settled** race populations would silently change the comparison denominator. Equal-sized settled sets with *different* race IDs are also insufficient. An extra refunded ticket on a race already containing a settled ticket must not disappear merely because the settled race set still matches.

## Deny-only local outcome-race check

The new `assessForwardV02LocalOutcomeRaceParity` first requires the existing linked-BUY race parity and exact manifest-ordered ledger content preflight. It then:

1. Builds per-system sets of locally `FINAL/SETTLED/evaluable=true` race IDs and separately retains the race IDs of every locally excluded outcome.
2. Rejects asymmetric settled race sets, including equal-sized but different race sets.
3. Rejects asymmetric excluded race sets, including an additional refunded ticket on an otherwise shared settled race.
4. Rejects empty settled populations and zero-stake locally settled outcomes.
5. Accepts only the narrow proposition that **caller-supplied local settled and excluded race sets align**; even this success returns `scoringAuthorized: false`.

The nine new tests cover ordinary aligned data, one-sided refund, all-refunded data, equal-cardinality mismatch, mixed settled/refunded tickets on one race, symmetric refunds, zero stake, tampered digest linkage, and unequal initial BUY race sets.

## What this deliberately does NOT prove

- The outcomes are independently authenticated, final `EXACT` settlement events; the same caller could fabricate both payload and digest.
- The enrollment protocol, cohort membership, snapshot and exclusion rule were frozen **before** the decisions; a post-result manifest cannot establish this.
- A `SETTLED/evaluable` flag was assigned by a trusted independent source rather than supplied by the caller.
- Matching *race sets* imply matching ticket counts, stakes, denominators, per-ticket exclusions, or any max-hit-removed retained population.
- Equal excluded race sets imply the same exclusion **reasons** or a formally approved v0.2 refund/void/cancelled policy.
- A protocol candidate is approved or scoring/promotion/production access is authorized.

The helper's successful result still blocks on `UNAPPROVED_PROTOCOL`, `PROSPECTIVE_COHORT_NOT_ATTESTED`, `INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED`, and `TICKET_STAKE_AND_FROZEN_EXCLUSION_POLICY_NOT_VERIFIED`.

## Next safe research step

Define a metadata-only, independently checkable prospective enrollment and terminal settlement/supersession **authority contract** before introducing any scoring gate. The contract must distinguish source-authenticated evidence from caller-recomputed digests, prove predecision freeze and exact terminal revision selection, and retain explicit missingness/exclusion reason coverage. Use synthetic negative fixtures first; do not activate protected N2, read private raw odds, or infer readiness counts.

No Current BUY, LINE, automated betting, public publishing, production settings, Owner Dashboard or protected N2 behavior was changed.

## Learning gate

- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. The missing eligible/excluded race parity was already documented in the v284 audit; this run made that existing limitation executable. Routine green CI does not create a new Learning record.
- fingerprintKey: `research-k3.forward-vault.v02-local-settled-excluded-race-parity`
- attemptSignature: `pr2286-v285-local-outcome-race-parity-synthetic-9-fixtures`
- environmentKey: `github-connector/research-pr-node24-ci`
- materialStateKey: `forward-v02-candidate/pr2286-758ae047/linked-buy-parity-without-local-outcome-exclusion-parity`
- Gate: `PROCEED_DISTINCT_SYNTHETIC_EXCLUSION_PARITY / REUSE_PRIOR_REFUND_AND_COHORT_GUARDRAILS`
- Reused: `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-forward-v02-unmatched-decision-coverage-20261024`, `LEARN-github-write-readback-20260918`.
- New `LEARN-*`: none; no identical failed attempt repeated.

**Merge remains blocked** regardless of green CI until independent prospective enrollment/settlement authority and the reviewed v0.2 evaluation contract exist.
